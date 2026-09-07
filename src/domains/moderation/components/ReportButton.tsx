'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Flag } from 'lucide-react';
import { REPORT_REASONS } from '@/domains/moderation/types';

interface ReportButtonProps {
  targetType: 'stream' | 'user' | 'message';
  targetId: string;
  /** 신고 당시 무엇을 보고 있었는지. 방송이 끝나면 알 수 없어진다 */
  context?: string;
  className?: string;
}

/**
 * 신고 버튼.
 *
 * 라이브는 흘러가버려서 나중에 확인할 수 없다. 그래서 신고 시점의 맥락
 * (방송 제목·방송자)을 같이 보낸다 — 운영자가 볼 때는 이미 끝난 방송이다.
 */
export function ReportButton({
  targetType,
  targetId,
  context,
  className = '',
}: ReportButtonProps) {
  const t = useTranslations('report');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(reason: string) {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, reason, context }),
      });

      if (res.status === 401) {
        setError(t('loginRequired'));
        return;
      }
      if (!res.ok) {
        const { error: message } = await res.json();
        setError(message ?? t('failed'));
        return;
      }

      setDone(true);
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 1500);
    } catch {
      setError(t('failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={t('report')}
        className={`flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60 ${className}`}
      >
        <Flag className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end bg-black/60"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-2xl bg-gray-900 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-white"
          >
            <p className="px-5 py-4 font-semibold">{t('reasonTitle')}</p>

            {done ? (
              <p className="px-5 pb-6 text-sm text-green-400">
                {t('submitted')}
              </p>
            ) : (
              <>
                {error && (
                  <p className="px-5 pb-2 text-sm text-red-400">{error}</p>
                )}
                <ul className="px-2 pb-2">
                  {REPORT_REASONS.map((reason) => (
                    <li key={reason}>
                      <button
                        disabled={pending}
                        onClick={() => submit(reason)}
                        className="w-full rounded-lg px-3 py-3 text-left text-sm transition-colors hover:bg-gray-800 disabled:opacity-50"
                      >
                        {t(`reason_${reason}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
