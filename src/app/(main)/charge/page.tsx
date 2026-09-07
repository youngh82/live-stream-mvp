'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowLeft, Coins, Check } from 'lucide-react';
import Link from 'next/link';
import { POINT_PACKAGES } from '@/domains/donation/types';

export default function ChargePage() {
  return (
    <Suspense>
      <ChargePageContent />
    </Suspense>
  );
}

function ChargePageContent() {
  const t = useTranslations('charge');
  const tDonation = useTranslations('donation');
  const format = useFormatter();
  const searchParams = useSearchParams();
  const canceled = searchParams.get('canceled');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/donation/balance')
      .then((r) => r.json())
      .then((d) => setBalance(d.balance))
      .catch(() => {});
  }, []);

  const handleCharge = async () => {
    if (selectedIndex === null || loading) return;
    setLoading(true);

    try {
      const res = await fetch('/api/donation/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageIndex: selectedIndex }),
      });
      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || t('checkoutFailed'));
      }
    } catch {
      alert(t('checkoutFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-lg px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Link href="/profile" className="p-1">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-bold">{t('title')}</h1>
        </div>

        {/* Balance */}
        <div className="mb-6 rounded-xl bg-gray-900 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Coins className="h-4 w-4 text-yellow-400" />
            {t('currentBalance')}
          </div>
          <p className="mt-1 text-2xl font-bold">
            {balance !== null ? tDonation('points', { amount: balance }) : '…'}
          </p>
        </div>

        {canceled && (
          <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
            {t('canceled')}
          </div>
        )}

        {/* Packages */}
        <div className="space-y-3">
          {POINT_PACKAGES.map((pkg, i) => (
            <button
              key={pkg.points}
              onClick={() => setSelectedIndex(i)}
              className={`flex w-full items-center justify-between rounded-xl border px-5 py-4 transition ${
                selectedIndex === i
                  ? 'border-purple-500 bg-purple-900/30'
                  : 'border-gray-800 bg-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                {selectedIndex === i && (
                  <Check className="h-5 w-5 text-purple-400" />
                )}
                <span className="text-base font-semibold">
                  {tDonation('points', { amount: pkg.points })}
                </span>
              </div>
              {/* 가격은 원화가 실제 청구 통화라 로케일과 무관하게 KRW로 보여준다.
                  숫자 표기(구분자·기호 위치)만 로케일을 따른다. */}
              <span className="text-sm text-gray-400">
                {format.number(pkg.price, {
                  style: 'currency',
                  currency: 'KRW',
                })}
              </span>
            </button>
          ))}
        </div>

        {/* Charge button */}
        <button
          onClick={handleCharge}
          disabled={selectedIndex === null || loading}
          className="mt-6 w-full rounded-xl bg-purple-600 py-4 text-base font-bold text-white transition disabled:opacity-40"
        >
          {loading ? t('processing') : t('checkout')}
        </button>

        <p className="mt-4 text-center text-xs text-gray-500">
          {t('testModeNotice')}
        </p>
      </div>
    </div>
  );
}
