'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Socket } from 'socket.io-client';

export interface DonationAlert {
  id: string;
  senderId: string;
  nickname: string;
  avatarUrl: string | null;
  amount: number;
  message: string | null;
}

interface UseDonationOptions {
  streamId: string;
  socket: Socket | null;
  connected: boolean;
}

export function useDonation({ streamId, socket, connected }: UseDonationOptions) {
  const t = useTranslations('donation');
  const [balance, setBalance] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [alerts, setAlerts] = useState<DonationAlert[]>([]);

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/donation/balance');
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Listen for donation alerts
  useEffect(() => {
    if (!socket || !connected) return;

    const onAlert = (alert: DonationAlert) => {
      setAlerts((prev) => [...prev, alert]);
    };

    socket.on('donation:alert', onAlert);
    return () => {
      socket.off('donation:alert', onAlert);
    };
  }, [socket, connected]);

  // Dismiss the first alert (queue system)
  const dismissAlert = useCallback(() => {
    setAlerts((prev) => prev.slice(1));
  }, []);

  // Send donation
  const sendDonation = useCallback(
    async (amount: number, message: string) => {
      if (sending) return { success: false, error: t('inProgress') };

      setSending(true);
      try {
        const res = await fetch('/api/donation/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ streamId, amount, message: message || null }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { success: false, error: data.error };
        }

        setBalance(data.balance);

        // 알림은 서버가 발행한다 (H-01).
        // 예전에는 여기서 socket.emit('donation:send', { amount })로 직접
        // 쐈기 때문에, 결제 없이 임의 금액의 후원 알림을 띄울 수 있었다.
        // 이제 API가 DB 커밋 후 Redis로 발행하고 채팅 서버가 중계한다.

        return { success: true, error: null };
      } catch {
        return { success: false, error: t('sendFailed') };
      } finally {
        setSending(false);
      }
    },
    [streamId, sending, t],
  );

  return { balance, sending, alerts, dismissAlert, sendDonation, fetchBalance };
}
