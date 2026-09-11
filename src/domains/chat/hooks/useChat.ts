'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSocket, type SocketStatus } from './useSocket';
import type { Socket } from 'socket.io-client';

export type SystemEvent = 'joined' | 'left';

export interface LiveChatMessage {
  id: string;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  content: string;
  type: 'message' | 'system' | 'donation';
  createdAt: string;
  /**
   * 시스템/후원 메시지는 **서버가 문장을 만들지 않는다.**
   * 한 방에 언어가 다른 사람들이 같이 있어서, 서버가 문장으로 굳히면
   * 모두가 서버가 고른 한 가지 언어를 본다. 서버는 무슨 일이 일어났는지만
   * 보내고 문구는 각자의 화면에서 만든다.
   */
  systemEvent?: SystemEvent;
  donation?: { amount: number; message: string | null };
}

interface UseChatOptions {
  streamId: string;
  enabled?: boolean;
  socket?: Socket | null;
  connected?: boolean;
  /** 외부 소켓을 넘길 때 그 소켓의 상태도 같이 넘긴다 (FeedItem) */
  status?: SocketStatus;
  retry?: () => void;
}

const MAX_MESSAGES = 100;

export function useChat({
  streamId,
  enabled = true,
  socket: externalSocket,
  connected: externalConnected,
  status: externalStatus,
  retry: externalRetry,
}: UseChatOptions) {
  const internal = useSocket(enabled && !externalSocket);
  const socket = externalSocket ?? internal.socket;
  const connected = externalConnected ?? internal.connected;
  const status = externalStatus ?? internal.status;
  const retry = externalRetry ?? internal.retry;
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  /** 이 채널에서 채팅이 금지된 상태. null이면 정상 */
  const [banned, setBanned] = useState<{
    expiresAt: string | null;
    reason?: string | null;
  } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !connected) return;

    socket.emit('chat:join', { streamId });

    const onMessage = (msg: LiveChatMessage) => {
      setMessages((prev) => {
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      });
    };

    const onSystem = (msg: {
      event?: SystemEvent;
      nickname?: string;
      content?: string;
      type: string;
    }) => {
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            id: crypto.randomUUID(),
            userId: '',
            nickname: msg.nickname ?? '',
            avatarUrl: null,
            // content는 구버전 서버가 문장을 보내던 경로다. 새 서버는
            // event를 보내므로 비어 있고, ChatMessage가 문구를 만든다.
            content: msg.content ?? '',
            systemEvent: msg.event,
            type: 'system' as const,
            createdAt: new Date().toISOString(),
          },
        ];
        return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      });
    };

    const onViewerCount = ({ count }: { count: number }) =>
      setViewerCount(count);

    const onError = ({ message }: { message: string }) => {
      // 거부 사유를 화면에 띄운다. 조용히 삼키면 유저는 자기 메시지가
      // 왜 안 보이는지 모른 채 "채팅이 고장났다"고 생각한다.
      setLastError(message);
      setTimeout(() => setLastError(null), 4000);
    };

    const onBanned = (payload: {
      expiresAt: string | null;
      reason?: string | null;
    }) => setBanned(payload);

    const onUnbanned = () => setBanned(null);

    // 메시지 삭제. 채팅은 저장되지 않으므로 각 클라이언트가 지우면 끝난다.
    const onDelete = ({ messageId }: { messageId: string }) =>
      setMessages((prev) => prev.filter((m) => m.id !== messageId));

    socket.on('chat:message', onMessage);
    socket.on('chat:system', onSystem);
    socket.on('chat:viewer_count', onViewerCount);
    socket.on('chat:error', onError);
    socket.on('chat:banned', onBanned);
    socket.on('chat:unbanned', onUnbanned);
    socket.on('chat:delete', onDelete);

    return () => {
      socket.emit('chat:leave', { streamId });
      socket.off('chat:message', onMessage);
      socket.off('chat:system', onSystem);
      socket.off('chat:viewer_count', onViewerCount);
      socket.off('chat:error', onError);
      socket.off('chat:banned', onBanned);
      socket.off('chat:unbanned', onUnbanned);
      socket.off('chat:delete', onDelete);
    };
  }, [socket, connected, streamId]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!socket?.connected) return;
      socket.emit('chat:send', { streamId, content });
    },
    [socket, streamId],
  );

  /** 로컬에서 즉시 지운다 (삭제 요청을 보낸 방송자 본인의 화면용) */
  const removeMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  return {
    messages,
    viewerCount,
    connected,
    status,
    retry,
    sendMessage,
    banned,
    lastError,
    removeMessage,
  };
}
