'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Ban,
  Check,
  Loader2,
  ShieldAlert,
  StopCircle,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useReportReasonLabel } from '@/domains/moderation/hooks/useReportReasonLabel';

/** 기본 정지 기간. 버튼 문구와 실제 전달값이 어긋나지 않도록 한 곳에서 정한다 */
const SUSPEND_DAYS = 7;

interface ReportGroup {
  target_type: 'stream' | 'user' | 'message';
  target_id: string;
  count: number;
  reasons: string[];
  report_ids: string[];
  first_at: string;
  target:
    | { id: string; nickname: string }
    | {
        id: string;
        title: string;
        status: string;
        user_id: string;
        users: { nickname: string };
      }
    | null;
}

/**
 * 운영자 화면.
 *
 * 신고 큐를 **대상별로 묶어서** 본다. 같은 방송에 신고가 20건 몰렸으면
 * 20줄이 아니라 한 줄에 "20건"이어야 무엇이 급한지 보인다.
 *
 * 권한 확인은 서버가 한다(`requireAdmin`). 여기서 화면을 감추는 건
 * 편의일 뿐 방어선이 아니다.
 */
export default function AdminPage() {
  const t = useTranslations('admin');
  const tStream = useTranslations('stream');
  const reasonLabel = useReportReasonLabel();
  const [items, setItems] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/reports');
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const { data } = await res.json();
      setItems(data ?? []);
    } catch {
      // 목록만 비고 화면은 남는다
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function act(
    action: string,
    payload: Record<string, unknown>,
    key: string,
  ) {
    if (busy) return;
    setBusy(key);
    try {
      await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-gray-950 text-gray-400">
        <ShieldAlert className="h-12 w-12 text-gray-700" />
        <p>{t('adminOnly')}</p>
        <Link href="/feed" className="text-sm text-blue-400 hover:underline">
          {t('backToFeed')}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
          <ShieldAlert className="h-6 w-6" />
          {t('title')}
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          {t('subtitle', { count: items.length })}
        </p>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gray-600" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-600">
            {t('empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const key = `${item.target_type}:${item.target_id}`;
              const isStream = item.target_type === 'stream';
              const streamTarget = isStream
                ? (item.target as {
                    id: string;
                    title: string;
                    status: string;
                    user_id: string;
                    users: { nickname: string };
                  } | null)
                : null;
              const userTarget = !isStream
                ? (item.target as { id: string; nickname: string } | null)
                : null;

              return (
                <li key={key} className="rounded-xl bg-gray-900 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {item.count >= 3 && (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                        )}
                        <span className="truncate">
                          {streamTarget
                            ? `${streamTarget.title} — ${streamTarget.users.nickname}`
                            : (userTarget?.nickname ??
                              `${item.target_type} ${item.target_id.slice(0, 8)}`)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t('reportCount', { count: item.count })}
                        {streamTarget && streamTarget.status === 'live' && (
                          <span className="ml-2 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {tStream('live')}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <ul className="mb-3 space-y-0.5">
                    {item.reasons.map((r, i) => (
                      <li key={i} className="text-xs text-gray-400">
                        · {reasonLabel(r)}
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap gap-2">
                    {streamTarget && (
                      <>
                        <Link
                          href={`/stream/${item.target_id}`}
                          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700"
                        >
                          {t('viewStream')}
                        </Link>
                        <button
                          disabled={busy === key}
                          onClick={() =>
                            act('end_stream', { targetId: item.target_id }, key)
                          }
                          className="flex items-center gap-1 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/30 disabled:opacity-50"
                        >
                          <StopCircle className="h-3.5 w-3.5" />
                          {t('forceEndStream')}
                        </button>
                      </>
                    )}

                    <button
                      disabled={busy === key}
                      onClick={() =>
                        act(
                          'suspend_user',
                          {
                            targetId: streamTarget
                              ? streamTarget.user_id
                              : item.target_id,
                            days: SUSPEND_DAYS,
                            note: item.reasons[0],
                          },
                          key,
                        )
                      }
                      className="flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-50"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      {t('suspendDays', { days: SUSPEND_DAYS })}
                    </button>

                    <button
                      disabled={busy === key}
                      onClick={() =>
                        act('resolve', { reportIds: item.report_ids }, key)
                      }
                      className="ml-auto flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-green-400 hover:bg-gray-700 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t('resolve')}
                    </button>
                    <button
                      disabled={busy === key}
                      onClick={() =>
                        act('reject', { reportIds: item.report_ids }, key)
                      }
                      className="flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-700 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t('reject')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
