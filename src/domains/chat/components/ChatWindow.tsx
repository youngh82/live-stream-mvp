'use client';

import { useEffect, useRef, useState } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import type { ChatTextSize } from './ChatMessage';
import type { LiveChatMessage } from '../hooks/useChat';
import { useTranslations } from 'next-intl';
import { Loader2, AArrowUp, AArrowDown, Ban } from 'lucide-react';
import {
  ModerationSheet,
  type ModerationTarget,
} from '@/domains/moderation/components/ModerationSheet';

const sizes: ChatTextSize[] = ['sm', 'md', 'lg'];

interface ChatWindowProps {
  messages: LiveChatMessage[];
  onSend: (content: string) => void;
  connected: boolean;
  /** 방송자 본인일 때만 제재 UI가 나온다 */
  isOwner?: boolean;
  streamId?: string;
  /** 채팅 금지 상태. null이면 정상 */
  banned?: { expiresAt: string | null; reason?: string | null } | null;
  /** 서버가 거부한 사유 (슬로우 모드·금칙어 등) */
  lastError?: string | null;
  onRemoveMessage?: (messageId: string) => void;
}

/**
 * 남은 제재 시간을 사람이 읽는 문구로.
 *
 * 단위를 분→시간→일로 올리는 이유는 "1440분 남음"이 아무 정보도 주지
 * 않기 때문이다. 복수형은 언어마다 규칙이 달라 사전의 ICU plural에 맡긴다.
 */
function formatUntil(
  expiresAt: string | null,
  t: ReturnType<typeof useTranslations<'chat'>>,
): string {
  if (!expiresAt) return t('banIndefinite');

  const remainMs = new Date(expiresAt).getTime() - Date.now();
  if (remainMs <= 0) return t('banEndingSoon');

  const min = Math.ceil(remainMs / 60000);
  if (min < 60) return t('banMinutesLeft', { count: min });
  const hours = Math.ceil(min / 60);
  if (hours < 24) return t('banHoursLeft', { count: hours });
  return t('banDaysLeft', { count: Math.ceil(hours / 24) });
}

export function ChatWindow({
  messages,
  onSend,
  connected,
  isOwner = false,
  streamId,
  banned = null,
  lastError = null,
  onRemoveMessage,
}: ChatWindowProps) {
  const t = useTranslations('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollRef = useRef(true);
  const [textSize, setTextSize] = useState<ChatTextSize>('md');
  const [modTarget, setModTarget] = useState<ModerationTarget | null>(null);

  useEffect(() => {
    if (isAutoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  const cycleSize = () => {
    setTextSize((prev) => {
      const idx = sizes.indexOf(prev);
      return sizes[(idx + 1) % sizes.length];
    });
  };

  // 하단 탭이 있는 화면(피드)에서는 탭 높이만큼 띄워서 입력창이 가리지 않게 한다.
  // --bottom-nav-h를 정의하지 않는 화면(개별 방송 페이지)에서는 0이 된다.
  return (
    <div
      style={{ bottom: 'var(--bottom-nav-h, 0px)' }}
      className="absolute inset-x-0 z-20 flex flex-col pb-[env(safe-area-inset-bottom)]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Text size toggle */}
      <div className="flex justify-end px-3 pb-1">
        <button
          onClick={cycleSize}
          className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-xs text-white backdrop-blur-sm active:bg-black/70"
        >
          {textSize === 'sm' ? (
            <AArrowDown className="h-4 w-4" />
          ) : (
            <AArrowUp className="h-4 w-4" />
          )}
          {t('textSize')} {t(`textSize_${textSize}`)}
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[35vh] overflow-y-auto px-3 py-1"
        style={{
          scrollbarWidth: 'none',
          maskImage: 'linear-gradient(transparent 0%, black 20%)',
        }}
      >
        {!connected && (
          <div className="flex items-center justify-center gap-2 py-2">
            <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
            <span className="text-xs text-gray-400">{t('connecting')}</span>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            userId={msg.userId}
            nickname={msg.nickname}
            content={msg.content}
            type={msg.type}
            systemEvent={msg.systemEvent}
            donation={msg.donation}
            textSize={textSize}
            // 시스템 메시지와 자기 자신에게는 제재 메뉴를 붙이지 않는다
            onModerate={
              isOwner && streamId && msg.userId && msg.type !== 'system'
                ? () =>
                    setModTarget({
                      messageId: msg.id,
                      userId: msg.userId,
                      nickname: msg.nickname,
                    })
                : undefined
            }
          />
        ))}
      </div>

      {/* 거부 사유. 조용히 삼키면 "채팅이 고장났다"는 신고로 돌아온다 */}
      {lastError && !banned && (
        <p className="px-4 pb-1 text-xs text-amber-300">{lastError}</p>
      )}

      {/* Input */}
      <div className="px-3 pb-3">
        {banned ? (
          <div className="flex items-center gap-2 rounded-full bg-red-500/15 px-4 py-2.5 text-xs text-red-200 ring-1 ring-red-500/30">
            <Ban className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              {t('banned')} · {formatUntil(banned.expiresAt, t)}
              {banned.reason && (
                <span className="text-red-300/70"> · {banned.reason}</span>
              )}
            </span>
          </div>
        ) : (
          <ChatInput onSend={onSend} disabled={!connected} />
        )}
      </div>

      {modTarget && streamId && (
        <ModerationSheet
          target={modTarget}
          streamId={streamId}
          onClose={() => setModTarget(null)}
          onDeleted={(id) => onRemoveMessage?.(id)}
        />
      )}
    </div>
  );
}
