'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { X, Coins } from 'lucide-react';
import { DONATION_PRESETS } from '@/domains/donation/types';

interface DonationPanelProps {
  balance: number | null;
  sending: boolean;
  onSend: (amount: number, message: string) => Promise<{ success: boolean; error: string | null }>;
  onClose: () => void;
  onCharge: () => void;
}

export function DonationPanel({
  balance,
  sending,
  onSend,
  onClose,
  onCharge,
}: DonationPanelProps) {
  const t = useTranslations('donation');
  const format = useFormatter();
  const [amount, setAmount] = useState<number>(DONATION_PRESETS[0]);
  const [customAmount, setCustomAmount] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const effectiveAmount = useCustom ? parseInt(customAmount) || 0 : amount;
  const canSend = effectiveAmount > 0 && !sending;

  const handleSend = async () => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setError(null);
    const result = await onSend(effectiveAmount, message);
    if (result.success) {
      onClose();
    } else {
      setError(result.error);
      setShowConfirm(false);
    }
  };

  return (
    // z-[70]: 하단 탭(BottomNav)이 z-50이고 DOM에서 뒤에 오기 때문에,
    // 같은 z-50이면 탭이 이 시트를 덮는다. 하필 가려지는 자리가 시트
    // 맨 아래의 후원 전송 버튼이라 후원 자체가 눌리지 않았다.
    // 제재 시트·신고 시트가 이미 z-[70]이라 모달 층을 그쪽에 맞춘다.
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-lg rounded-t-2xl bg-gray-900 p-5 pb-[env(safe-area-inset-bottom)]">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{t('title')}</h3>
          <button onClick={onClose} className="p-1 text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Balance */}
        <div className="mb-4 flex items-center justify-between rounded-lg bg-gray-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Coins className="h-4 w-4 text-yellow-400" />
            {t('myPoints')}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-bold text-white">
              {balance !== null ? t('points', { amount: balance }) : '…'}
            </span>
            <button
              onClick={onCharge}
              className="rounded-full bg-purple-600 px-3 py-1 text-xs font-semibold text-white"
            >
              {t('charge')}
            </button>
          </div>
        </div>

        {/* Amount presets */}
        <div className="mb-3 grid grid-cols-5 gap-2">
          {DONATION_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setAmount(preset);
                setUseCustom(false);
                setShowConfirm(false);
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                !useCustom && amount === preset
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-300'
              }`}
            >
              {format.number(preset)}
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <div className="mb-3">
          <input
            type="number"
            placeholder={t('customAmount')}
            value={customAmount}
            onChange={(e) => {
              setCustomAmount(e.target.value);
              setUseCustom(true);
              setShowConfirm(false);
            }}
            onFocus={() => setUseCustom(true)}
            className="w-full rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-purple-500"
            style={{ color: 'white' }}
            min={1}
          />
        </div>

        {/* Message */}
        <div className="mb-4">
          <input
            type="text"
            placeholder={t('messagePlaceholder')}
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 50))}
            className="w-full rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-purple-500"
            style={{ color: 'white' }}
            maxLength={50}
          />
          <p className="mt-1 text-right text-xs text-gray-500">
            {message.length}/50
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="mb-3 text-center text-sm text-red-400">{error}</p>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`w-full rounded-xl py-3.5 text-base font-bold transition ${
            showConfirm
              ? 'bg-yellow-500 text-black'
              : 'bg-purple-600 text-white'
          } disabled:opacity-40`}
        >
          {sending
            ? t('sending')
            : showConfirm
              ? t('confirmSend', { amount: effectiveAmount })
              : t('send', { amount: effectiveAmount })}
        </button>
      </div>
    </div>
  );
}
