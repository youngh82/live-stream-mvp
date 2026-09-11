'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { createClient } from '@/shared/lib/supabase-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

/**
 * - connecting: 연결 시도 중(재연결 포함)
 * - connected: 연결됨
 * - signed-out: 로그인 세션이 없다. 채팅 서버는 토큰 없이 받지 않는다
 * - failed: 서버가 거절했거나 재연결을 포기했다. retry()로 다시 시도
 *
 * **예전에는 실패 상태가 없었다.** 세션이 없거나 서버가 토큰을 거절하면
 * `connected`가 영원히 false라 화면이 "채팅 연결 중..."에서 멈췄다.
 * 서버 미들웨어의 거절(connect_error)은 Socket.IO가 자동 재시도하지 않는다.
 */
export type SocketStatus = 'connecting' | 'connected' | 'signed-out' | 'failed';

export function useSocket(enabled = true): {
  socket: Socket | null;
  connected: boolean;
  status: SocketStatus;
  retry: () => void;
} {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const init = async () => {
      setStatus('connecting');
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        setStatus('signed-out');
        return;
      }

      let token = session.access_token;
      let refreshed = false;

      const s = io(WS_URL, {
        // 함수로 넘겨야 재연결 때마다 최신 토큰을 쓴다
        auth: (cb) => cb({ token }),
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      s.on('connect', () => {
        if (cancelled) return;
        setConnected(true);
        setStatus('connected');
      });
      s.on('disconnect', () => {
        if (cancelled) return;
        setConnected(false);
        setStatus('connecting');
      });
      s.on('connect_error', async () => {
        // 네트워크 오류면 Socket.IO가 알아서 재시도한다(s.active === true).
        // 서버가 거절한 경우만 여기서 처리한다 — 대부분 만료된 토큰이다.
        if (cancelled || s.active) return;
        if (!refreshed) {
          refreshed = true;
          const { data } = await supabase.auth.refreshSession();
          if (cancelled) return;
          if (data.session) {
            token = data.session.access_token;
            s.connect();
            return;
          }
          setStatus('signed-out');
          return;
        }
        setStatus('failed');
      });
      s.io.on('reconnect_failed', () => {
        if (!cancelled) setStatus('failed');
      });

      socketRef.current = s;
      setSocket(s);
    };

    init();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { socket, connected, status, retry };
}
