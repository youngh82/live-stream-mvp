'use client';

import { Suspense, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle } from 'lucide-react';
import Link from 'next/link';

function ChargeSuccessContent() {
  const t = useTranslations('charge');
  const tDonation = useTranslations('donation');
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch('/api/donation/balance')
        .then((r) => r.json())
        .then((d) => setBalance(d.balance))
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="mx-auto max-w-sm px-4 text-center">
        <CheckCircle className="mx-auto h-16 w-16 text-green-400" />
        <h1 className="mt-4 text-xl font-bold">{t('successTitle')}</h1>
        <p className="mt-2 text-sm text-gray-400">{t('successBody')}</p>
        {balance !== null && (
          <p className="mt-3 text-lg font-bold text-yellow-400">
            {t('newBalance', { balance: tDonation('points', { amount: balance }) })}
          </p>
        )}
        <div className="mt-8 flex gap-3">
          <Link
            href="/feed"
            className="flex-1 rounded-xl bg-purple-600 py-3 font-semibold"
          >
            {t('goToFeed')}
          </Link>
          <Link
            href="/charge"
            className="flex-1 rounded-xl bg-gray-800 py-3 font-semibold"
          >
            {t('topUpMore')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ChargeSuccessPage() {
  return (
    <Suspense>
      <ChargeSuccessContent />
    </Suspense>
  );
}
