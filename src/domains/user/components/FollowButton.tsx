'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Plus } from 'lucide-react';
import { useFollow } from '@/domains/user/hooks/useFollow';

interface FollowButtonProps {
  userId: string;
  initialFollowing?: boolean;
  initialCount?: number;
  /** compact: 피드 오버레이용 아이콘 버튼 */
  variant?: 'default' | 'compact';
  showCount?: boolean;
  className?: string;
}

export function FollowButton({
  userId,
  initialFollowing = false,
  initialCount = 0,
  variant = 'default',
  showCount = false,
  className = '',
}: FollowButtonProps) {
  const t = useTranslations('user');
  const router = useRouter();
  const { following, count, pending, toggle } = useFollow({
    userId,
    initialFollowing,
    initialCount,
    onRequireLogin: () => router.push('/login'),
  });

  function handleClick(e: React.MouseEvent) {
    // 피드 오버레이는 클릭으로 UI를 토글한다. 버블링되면 같이 반응한다.
    e.stopPropagation();
    toggle();
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={following ? t('unfollow') : t('follow')}
        className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
          following
            ? 'bg-white/20 text-white'
            : 'bg-red-500 text-white hover:bg-red-600'
        } ${className}`}
      >
        {following ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        {following ? t('following') : t('follow')}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={`flex items-center justify-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
        following
          ? 'bg-white/10 text-white hover:bg-white/20'
          : 'bg-red-500 text-white hover:bg-red-600'
      } ${className}`}
    >
      {following ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      {following ? t('following') : t('follow')}
      {showCount && <span className="opacity-70">{count.toLocaleString()}</span>}
    </button>
  );
}
