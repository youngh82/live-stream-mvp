'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Radio, X } from 'lucide-react';
import { useSocket } from '@/domains/chat/hooks/useSocket';

interface LiveNotification {
  streamId: string;
  streamerId: string;
  nickname: string;
  avatarUrl: string | null;
  title: string;
}

/** 화면에 동시에 띄우는 최대 개수 */
const MAX_VISIBLE = 3;
const DISMISS_MS = 8000;

/**
 * 팔로우한 방송자의 라이브 시작 알림.
 *
 * 앱 내 알림만 담당한다. 앱을 닫은 상태의 푸시(Web Push)는 서비스워커·
 * VAPID 키·구독 테이블이 따로 필요해서 별도 작업이다.
 *
 * 소켓은 로그인 상태에서만 열린다 (useSocket이 세션 토큰을 요구한다).
 */
export function LiveNotifications() {
  const t = useTranslations('user');
  const router = useRouter();
  const { socket } = useSocket(true);
  const [items, setItems] = useState<LiveNotification[]>([]);

  useEffect(() => {
    if (!socket) return;

    const onLive = (payload: LiveNotification) => {
      setItems((prev) => {
        // 같은 방송이 두 번 오면(재연결 등) 늘리지 않는다
        if (prev.some((p) => p.streamId === payload.streamId)) return prev;
        return [payload, ...prev].slice(0, MAX_VISIBLE);
      });

      setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.streamId !== payload.streamId));
      }, DISMISS_MS);
    };

    socket.on('notification:live', onLive);
    return () => {
      socket.off('notification:live', onLive);
    };
  }, [socket]);

  if (items.length === 0) return null;

  return (
    // BottomNav(z-50) 위에 떠야 알림이 가려지지 않는다
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      {items.map((item) => (
        <div
          key={item.streamId}
          onClick={() => {
            setItems((prev) =>
              prev.filter((p) => p.streamId !== item.streamId),
            );
            router.push(`/stream/${item.streamId}`);
          }}
          className="pointer-events-auto flex w-full max-w-sm cursor-pointer items-center gap-3 rounded-xl bg-gray-900/95 p-3 text-white shadow-lg ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-gray-800/95"
        >
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-gray-700">
            {item.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.avatarUrl}
                alt={item.nickname}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-bold">
                {item.nickname[0]?.toUpperCase()}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Radio className="h-3 w-3 shrink-0 text-red-500" />
              <span className="truncate">{item.nickname}</span>
              <span className="shrink-0 text-xs font-normal text-gray-400">
                {t('wentLive')}
              </span>
            </p>
            <p className="truncate text-xs text-gray-400">{item.title}</p>
          </div>

          <button
            type="button"
            aria-label={t('dismiss')}
            onClick={(e) => {
              e.stopPropagation();
              setItems((prev) =>
                prev.filter((p) => p.streamId !== item.streamId),
              );
            }}
            className="shrink-0 rounded p-1 text-gray-500 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
