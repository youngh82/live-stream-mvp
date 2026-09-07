'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Ban, Clock, Trash2, User, X } from 'lucide-react';
import { BAN_PRESETS, TIMEOUT_PRESETS } from '@/domains/moderation/types';
import { useDurationLabel } from '@/domains/moderation/hooks/useDurationLabel';

export interface ModerationTarget {
  messageId: string;
  userId: string;
  nickname: string;
}

interface ModerationSheetProps {
  target: ModerationTarget;
  streamId: string;
  onClose: () => void;
  /** 삭제한 메시지를 내 화면에서도 즉시 지운다 */
  onDeleted: (messageId: string) => void;
}

/**
 * 채팅 제재 액션 시트.
 *
 * **방송 화면을 벗어나지 않는 것이 핵심이다.** 별도 페이지로 보내면
 * 제재하는 동안 방송이 끊긴다. 롱프레스로 열리고 한 번의 탭으로 끝난다.
 *
 * 타임아웃·기간 차단·영구 차단은 서버에서 전부 같은 것이다
 * (durationSeconds가 null이면 영구).
 */
export function ModerationSheet({
  target,
  streamId,
  onClose,
  onDeleted,
}: ModerationSheetProps) {
  const t = useTranslations('moderation');
  const durationLabel = useDurationLabel();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ban(durationSeconds: number | null) {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const res = await fetch('/api/moderation/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: target.userId,
          durationSeconds,
        }),
      });
      if (!res.ok) {
        const { error: message } = await res.json();
        setError(message ?? t('actionFailed'));
        return;
      }
      onClose();
    } catch {
      setError(t('actionFailed'));
    } finally {
      setPending(false);
    }
  }

  async function deleteMessage() {
    if (pending) return;
    setPending(true);

    try {
      const res = await fetch('/api/moderation/message', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamId,
          messageId: target.messageId,
          targetUserId: target.userId,
        }),
      });
      if (res.ok) {
        onDeleted(target.messageId);
        onClose();
      } else {
        setError(t('deleteFailed'));
      }
    } catch {
      setError(t('deleteFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/60"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-2xl bg-gray-900 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-white"
      >
        <div className="flex items-center justify-between px-5 py-4">
          <p className="truncate font-semibold">{target.nickname}</p>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="text-gray-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <p className="px-5 pb-2 text-sm text-red-400">{error}</p>
        )}

        <div className="space-y-4 px-5">
          <section>
            <p className="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
              <Clock className="h-3.5 w-3.5" />
              {t('timeout')}
            </p>
            <div className="flex flex-wrap gap-2">
              {TIMEOUT_PRESETS.map((seconds) => (
                <button
                  key={seconds}
                  disabled={pending}
                  onClick={() => ban(seconds)}
                  className="rounded-lg bg-gray-800 px-3 py-2 text-sm transition-colors hover:bg-gray-700 disabled:opacity-50"
                >
                  {durationLabel(seconds)}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
              <Ban className="h-3.5 w-3.5" />
              {t('ban')}
            </p>
            <div className="flex flex-wrap gap-2">
              {BAN_PRESETS.map((seconds) => (
                <button
                  key={seconds ?? 'permanent'}
                  disabled={pending}
                  onClick={() => ban(seconds)}
                  className={`rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                    seconds === null
                      ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  {durationLabel(seconds)}
                </button>
              ))}
            </div>
          </section>

          <div className="flex gap-2 pt-1">
            <button
              disabled={pending}
              onClick={deleteMessage}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-800 py-2.5 text-sm transition-colors hover:bg-gray-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t('deleteMessage')}
            </button>
            <Link
              href={`/u/${target.userId}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-800 py-2.5 text-sm transition-colors hover:bg-gray-700"
            >
              <User className="h-4 w-4" />
              {t('profile')}
            </Link>
          </div>

          {/* 지킬 수 없는 약속을 UI로 하지 않는다.
              WHEP URL에 비밀이 없어서 시청 차단은 지금 구조로 불가능하다. */}
          <p className="pt-1 text-center text-[11px] text-gray-600">
            {t('chatOnlyNotice')}
          </p>
        </div>
      </div>
    </div>
  );
}
