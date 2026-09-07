'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Share2 } from 'lucide-react';

interface ShareButtonProps {
  /** 공유할 경로. 절대 URL은 브라우저의 origin으로 만든다 */
  path: string;
  title: string;
  text?: string;
  className?: string;
}

/**
 * 공유 버튼.
 *
 * Web Share API는 모바일 브라우저에서만 있고, 데스크톱에서는 없거나
 * 사용자가 시트를 닫으면 AbortError를 던진다. 그래서 실패를 전부 클립보드
 * 복사로 흡수한다 — 어느 경로로 가도 "공유가 아무 일도 안 하는" 상태는 없다.
 */
export function ShareButton({
  path,
  title,
  text,
  className = '',
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const t = useTranslations('common');

  async function handleShare(e: React.MouseEvent) {
    // 오버레이 토글(부모의 onClick)이 같이 발동하지 않도록
    e.stopPropagation();

    const url =
      typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // 취소했거나 지원하지 않음 → 복사로 폴백
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard도 막힌 환경(비 secure context 등)에서는 조용히 포기한다
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={t('share')}
      className={`flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60 ${className}`}
    >
      {copied ? (
        <Check className="h-5 w-5 text-green-400" />
      ) : (
        <Share2 className="h-5 w-5" />
      )}
    </button>
  );
}
