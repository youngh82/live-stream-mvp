'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDonationTier } from '@/domains/donation/types';
import type { DonationAlert as DonationAlertType } from '@/domains/donation/hooks/useDonation';

interface DonationAlertProps {
  alert: DonationAlertType | undefined;
  onDismiss: () => void;
}

const tierConfig = {
  basic: { duration: 2000, bg: 'bg-gray-800/90', border: 'border-gray-600', size: 'text-sm' },
  highlight: { duration: 3000, bg: 'bg-yellow-900/90', border: 'border-yellow-500', size: 'text-base' },
  special: { duration: 5000, bg: 'bg-gradient-to-r from-purple-900/90 to-yellow-900/90', border: 'border-yellow-400', size: 'text-lg' },
};

export function DonationAlertDisplay({ alert, onDismiss }: DonationAlertProps) {
  const t = useTranslations('donation');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!alert) return;

    setVisible(true);
    const tier = getDonationTier(alert.amount);
    const config = tierConfig[tier];

    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // wait for fade out animation
    }, config.duration);

    return () => clearTimeout(timer);
  }, [alert, onDismiss]);

  if (!alert) return null;

  const tier = getDonationTier(alert.amount);
  const config = tierConfig[tier];

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-20 z-40 flex justify-center transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
      }`}
    >
      <div
        className={`mx-4 max-w-sm rounded-xl border ${config.border} ${config.bg} px-5 py-4 text-center shadow-2xl backdrop-blur-sm ${
          tier === 'special' ? 'animate-pulse' : ''
        }`}
      >
        <p className="text-xs font-semibold text-yellow-300">
          {alert.nickname}
        </p>
        <p className={`mt-1 font-bold text-yellow-400 ${config.size}`}>
          {t('points', { amount: alert.amount })}
        </p>
        {alert.message && (
          <p className="mt-1 text-sm text-white/90">{alert.message}</p>
        )}
      </div>
    </div>
  );
}
