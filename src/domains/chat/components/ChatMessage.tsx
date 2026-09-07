'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { SystemEvent } from '@/domains/chat/hooks/useChat';

export type ChatTextSize = 'sm' | 'md' | 'lg';

const sizeStyles: Record<ChatTextSize, { nickname: string; content: string; system: string }> = {
  sm: { nickname: 'text-[11px]', content: 'text-[11px]', system: 'text-[10px]' },
  md: { nickname: 'text-xs', content: 'text-xs', system: 'text-[11px]' },
  lg: { nickname: 'text-sm', content: 'text-sm', system: 'text-xs' },
};

interface ChatMessageProps {
  /** 시스템 메시지에는 없다 */
  userId?: string;
  nickname: string;
  content: string;
  type: 'message' | 'system' | 'donation';
  /** 시스템 메시지의 종류. 있으면 content 대신 이걸로 문구를 만든다 */
  systemEvent?: SystemEvent;
  /** 후원 메시지의 원본 값. 있으면 content 대신 이걸로 문구를 만든다 */
  donation?: { amount: number; message: string | null };
  textSize?: ChatTextSize;
  /** 주면 롱프레스로 제재 시트가 열린다 (방송자에게만 준다) */
  onModerate?: () => void;
}

/** 이 시간 이상 누르고 있으면 롱프레스 */
const LONG_PRESS_MS = 500;

/**
 * 롱프레스 감지.
 *
 * 모바일에는 우클릭이 없어서 제재 진입점이 롱프레스뿐이다.
 * 스크롤하려고 누른 채 움직인 경우는 취소해야 한다 — 안 그러면
 * 채팅을 넘길 때마다 시트가 뜬다.
 */
function useLongPress(onLongPress?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (!onLongPress) return {};

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };

  return {
    onPointerDown: () => {
      clear();
      timer.current = setTimeout(onLongPress, LONG_PRESS_MS);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onPointerMove: clear,
    onContextMenu: (e: React.MouseEvent) => {
      // 데스크톱 우클릭도 같은 시트를 연다
      e.preventDefault();
      onLongPress();
    },
  };
}

/**
 * 닉네임 → 공개 프로필.
 *
 * 채팅은 방송 중인 사람을 처음 발견하는 자리이기도 하다. 여기서 프로필로
 * 갈 수 없으면 "저 사람 누구지"에서 동선이 끊긴다.
 * 오버레이의 클릭 토글에 묻히지 않도록 stopPropagation한다.
 */
function NicknameLink({
  userId,
  className,
  children,
}: {
  userId?: string;
  className: string;
  children: React.ReactNode;
}) {
  if (!userId) return <span className={className}>{children}</span>;

  return (
    <Link
      href={`/u/${userId}`}
      onClick={(e) => e.stopPropagation()}
      className={className}
    >
      {children}
    </Link>
  );
}

export function ChatMessage({
  userId,
  nickname,
  content,
  type,
  systemEvent,
  donation,
  textSize = 'md',
  onModerate,
}: ChatMessageProps) {
  const t = useTranslations('chat');
  const s = sizeStyles[textSize];
  const longPress = useLongPress(onModerate);

  if (type === 'system') {
    // systemEvent가 없으면 서버가 보낸 문장을 그대로 쓴다 —
    // 구버전 채팅 서버와 섞여 돌 때 빈 줄이 뜨지 않게 하기 위한 폴백이다.
    const text = systemEvent
      ? t(`system_${systemEvent}`, { nickname })
      : content;

    return (
      <div className="py-0.5 text-center">
        <span className={`${s.system} text-gray-400`}>{text}</span>
      </div>
    );
  }

  if (type === 'donation') {
    const text = donation
      ? donation.message
        ? t('donationWithMessage', {
            amount: donation.amount,
            message: donation.message,
          })
        : t('donationLine', { amount: donation.amount })
      : content;

    return (
      <div {...longPress} className="rounded-md bg-yellow-500/20 px-2 py-1">
        <NicknameLink userId={userId} className={`${s.nickname} font-bold text-yellow-300`}>
          {nickname}
        </NicknameLink>
        <span className={`ml-1.5 ${s.content} text-yellow-100`}>{text}</span>
      </div>
    );
  }

  return (
    <div {...longPress} className="py-0.5">
      <NicknameLink userId={userId} className={`${s.nickname} font-semibold text-purple-300`}>
        {nickname}
      </NicknameLink>
      <span className={`ml-1.5 ${s.content} text-white/90`}>{content}</span>
    </div>
  );
}
