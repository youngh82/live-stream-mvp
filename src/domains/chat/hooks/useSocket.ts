'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { createClient } from '@/shared/lib/supabase-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

export function useSocket(enabled = true): {
  socket: Socket | null;
  connected: boolean;
} {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const init = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      const s = io(WS_URL, {
        auth: { token: session.access_token },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      s.on('connect', () => {
        if (!cancelled) setConnected(true);
      });
      s.on('disconnect', () => {
        if (!cancelled) setConnected(false);
      });

      socketRef.current = s;
      if (!cancelled) setSocket(s);
    };

    init();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [enabled]);

  return { socket, connected };
}
