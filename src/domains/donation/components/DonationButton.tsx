'use client';

import { useTranslations } from 'next-intl';
import { Gift } from 'lucide-react';

interface DonationButtonProps {
  onClick: () => void;
}

export function DonationButton({ onClick }: DonationButtonProps) {
  const t = useTranslations('donation');

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-1.5 rounded-full bg-yellow-500/90 px-3.5 py-2 text-xs font-bold text-black shadow-lg transition active:scale-95"
    >
      <Gift className="h-4 w-4" />
      {t('cta')}
    </button>
  );
}
