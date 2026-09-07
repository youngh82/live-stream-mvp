'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Compass } from 'lucide-react';
import { FollowButton } from '@/domains/user/components/FollowButton';

interface StreamEndedScreenProps {
  streamerId: string;
  streamerName: string;
  streamerAvatar: string | null;
  isFollowing?: boolean;
  isMe?: boolean;
  /** 대기 중(idle)인지 종료(ended)인지 */
  idle?: boolean;
}

/**
 * 방송 종료 화면.
 *
 * 그냥 "방송이 종료되었습니다" 한 줄을 띄우면 시청자가 나가는 것 말고
 * 할 수 있는 게 없다. **팔로우 전환율이 가장 높은 순간이 여기다** —
 * 방금까지 보던 사람의 다음 방송을 받아볼 유일한 접점이므로
 * 팔로우와 다음 라이브를 같이 제안한다.
 */
export function StreamEndedScreen({
  streamerId,
  streamerName,
  streamerAvatar,
  isFollowing = false,
  isMe = false,
  idle = false,
}: StreamEndedScreenProps) {
  const t = useTranslations('streamEnded');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
      <Link href={`/u/${streamerId}`} className="flex flex-col items-center gap-3">
        <div className="h-20 w-20 overflow-hidden rounded-full bg-gray-800">
          {streamerAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={streamerAvatar}
              alt={streamerName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white">
              {streamerName[0]?.toUpperCase()}
            </div>
          )}
        </div>
        <p className="text-lg font-semibold text-white">{streamerName}</p>
      </Link>

      <p className="text-sm text-gray-400">
        {idle ? t('idle') : t('ended')}
      </p>

      {!isMe && (
        <>
          <FollowButton
            userId={streamerId}
            initialFollowing={isFollowing}
            className="px-8 py-2.5"
          />
          <p className="-mt-2 text-xs text-gray-500">
            {t('followHint')}
          </p>
        </>
      )}

      <Link
        href="/feed"
        className="mt-2 flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-sm text-white transition-colors hover:bg-white/20"
      >
        <Compass className="h-4 w-4" />
        {t('browseOther')}
      </Link>
    </div>
  );
}
