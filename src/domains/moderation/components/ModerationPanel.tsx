'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Loader2, ShieldBan } from 'lucide-react';
import {
  MAX_BANNED_WORDS,
  type ChannelSettings,
} from '@/domains/moderation/types';
import { useDurationLabel } from '@/domains/moderation/hooks/useDurationLabel';

interface BanRow {
  user_id: string;
  expires_at: string | null;
  reason: string | null;
  created_at: string;
  users: { id: string; nickname: string; avatar_url: string | null } | null;
}

const SLOW_MODE_OPTIONS = [0, 3, 5, 10, 30, 60] as const;



/**
 * 방송 대시보드의 모더레이션 패널.
 *
 * 방송 중 제재는 채팅 롱프레스로 하고, 여기서는 **되돌아보는 일**을 한다 —
 * 누구를 막아뒀는지 확인하고 푸는 것, 그리고 채널 채팅 규칙 설정.
 */
export function ModerationPanel() {
  const t = useTranslations('moderation');
  const format = useFormatter();
  const durationLabel = useDurationLabel();

  /** 차단 만료 표시. 날짜 형식은 로케일이 정한다 (2026. 9. 6. / Sep 6, 2026). */
  function formatUntil(expiresAt: string | null): string {
    if (!expiresAt) return durationLabel(null);
    return t('bannedUntil', {
      date: format.dateTime(new Date(expiresAt), 'short'),
    });
  }

  const [bans, setBans] = useState<BanRow[]>([]);
  const [settings, setSettings] = useState<Omit<
    ChannelSettings,
    'channel_id'
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [wordsInput, setWordsInput] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [bansRes, settingsRes] = await Promise.all([
        fetch('/api/moderation/ban'),
        fetch('/api/moderation/settings'),
      ]);
      const bansJson = await bansRes.json();
      const settingsJson = await settingsRes.json();

      if (bansJson.data) setBans(bansJson.data);
      if (settingsJson.data) {
        setSettings(settingsJson.data);
        setWordsInput((settingsJson.data.banned_words ?? []).join(', '));
      }
    } catch {
      // 패널만 비고 대시보드의 나머지는 정상 동작한다
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function saveSettings(patch: Record<string, unknown>) {
    try {
      const res = await fetch('/api/moderation/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const { data } = await res.json();
      if (data) {
        setSettings(data);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // 저장 실패는 다음 시도로
    }
  }

  async function unban(userId: string) {
    // 낙관적 제거. 실패하면 다시 불러온다.
    setBans((prev) => prev.filter((b) => b.user_id !== userId));
    try {
      const res = await fetch(`/api/moderation/ban?userId=${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) load();
    } catch {
      load();
    }
  }

  return (
    <section className="mb-6 rounded-xl bg-gray-900 p-6">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <ShieldBan className="h-5 w-5" />
        {t('chatManagement')}
      </h2>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-gray-600" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 채팅 규칙 */}
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-400">
                {t('slowMode')}
              </label>
              <div className="flex flex-wrap gap-2">
                {SLOW_MODE_OPTIONS.map((sec) => (
                  <button
                    key={sec}
                    onClick={() => saveSettings({ slowModeSec: sec })}
                    className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      settings?.slow_mode_sec === sec
                        ? 'bg-white font-semibold text-black'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {sec === 0 ? t('slowModeOff') : durationLabel(sec)}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between">
              <span className="text-sm text-gray-400">
                {t('followersOnly')}
                <span className="mt-0.5 block text-xs text-gray-600">
                  {t('followersOnlyHint')}
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings?.followers_only ?? false}
                onChange={(e) =>
                  saveSettings({ followersOnly: e.target.checked })
                }
                className="h-5 w-5 accent-white"
              />
            </label>

            <div>
              <label className="mb-1.5 block text-sm text-gray-400">
                {t('bannedWords')}{' '}
                <span className="text-gray-600">
                  {t('bannedWordsHint', { max: MAX_BANNED_WORDS })}
                </span>
              </label>
              <input
                type="text"
                value={wordsInput}
                onChange={(e) => setWordsInput(e.target.value)}
                onBlur={() =>
                  saveSettings({
                    bannedWords: wordsInput
                      .split(',')
                      .map((w) => w.trim())
                      .filter(Boolean),
                  })
                }
                placeholder={t('bannedWordsPlaceholder')}
                className="w-full rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500"
              />
            </div>

            {saved && <p className="text-xs text-green-400">{t('saved')}</p>}
          </div>

          {/* 차단 목록 */}
          <div>
            <h3 className="mb-2 text-sm text-gray-400">
              {t('banList')} {bans.length > 0 && `(${bans.length})`}
            </h3>

            {bans.length === 0 ? (
              <p className="text-sm text-gray-600">{t('noBans')}</p>
            ) : (
              <ul className="space-y-1">
                {bans.map((b) => (
                  <li
                    key={b.user_id}
                    className="flex items-center gap-3 rounded-lg bg-gray-800/60 px-3 py-2"
                  >
                    <Link
                      href={`/u/${b.user_id}`}
                      className="min-w-0 flex-1 truncate text-sm hover:underline"
                    >
                      {b.users?.nickname ?? b.user_id.slice(0, 8)}
                    </Link>
                    <span className="shrink-0 text-xs text-gray-500">
                      {formatUntil(b.expires_at)}
                    </span>
                    <button
                      onClick={() => unban(b.user_id)}
                      className="shrink-0 rounded-md bg-gray-700 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-600"
                    >
                      {t('unban')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
