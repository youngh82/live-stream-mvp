'use client';

import { useEffect, useState, useCallback } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DonationWithUsers } from '@/domains/donation/types';

interface DonationHistoryProps {
  type: 'sent' | 'received';
}

export function DonationHistory({ type }: DonationHistoryProps) {
  const t = useTranslations('donation');
  const format = useFormatter();
  const [donations, setDonations] = useState<DonationWithUsers[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const fetchDonations = useCallback(
    async (cursor?: string) => {
      try {
        const params = new URLSearchParams({ type, limit: '20' });
        if (cursor) params.set('cursor', cursor);

        const res = await fetch(`/api/donation/history?${params}`);
        if (!res.ok) return;
        const data = await res.json();

        if (cursor) {
          setDonations((prev) => [...prev, ...data.donations]);
        } else {
          setDonations(data.donations);
        }
        setNextCursor(data.nextCursor);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [type],
  );

  useEffect(() => {
    fetchDonations();
  }, [fetchDonations]);

  if (loading) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">{t('loading')}</p>
    );
  }

  if (donations.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">
        {type === 'received' ? t('noneReceived') : t('noneSent')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {donations.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between rounded-lg bg-gray-800 px-4 py-3"
        >
          <div>
            <p className="text-sm text-white">
              {type === 'received'
                ? d.sender.nickname
                : d.receiver.nickname}
            </p>
            {d.message && (
              <p className="mt-0.5 text-xs text-gray-400">{d.message}</p>
            )}
            <p className="mt-0.5 text-[10px] text-gray-500">
              {/* 후원은 시각까지 보여준다. 같은 날 여러 건이 오면
                  날짜만으로는 순서를 알 수 없다. */}
              {format.dateTime(new Date(d.created_at), 'full')}
            </p>
          </div>
          <span className="text-sm font-bold text-yellow-400">
            {t('points', { amount: d.amount })}
          </span>
        </div>
      ))}

      {nextCursor && (
        <button
          onClick={() => fetchDonations(nextCursor)}
          className="w-full py-3 text-center text-sm text-purple-400"
        >
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}
