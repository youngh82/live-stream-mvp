'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, Radio } from 'lucide-react';
import { ShareButton } from '@/shared/components/ShareButton';
import { FollowButton } from '@/domains/user/components/FollowButton';
import { ReportButton } from '@/domains/moderation/components/ReportButton';

interface StreamOverlayProps {
  title: string;
  streamerName: string;
  streamerAvatar: string | null;
  viewerCount: number;
  /** 주면 공유 버튼이 나온다 (예: `/stream/<id>`) */
  shareUrl?: string;
  /** 주면 방송자 이름이 프로필로 링크되고 팔로우 버튼이 붙는다 */
  streamerId?: string;
  isFollowing?: boolean;
  /** 내 방송이면 팔로우 버튼을 숨긴다 */
  isMe?: boolean;
  /** 주면 신고 버튼이 나온다 */
  streamId?: string;
}

export function StreamOverlay({
  title,
  streamerName,
  streamerAvatar,
  viewerCount,
  shareUrl,
  streamerId,
  isFollowing = false,
  isMe = false,
  streamId,
}: StreamOverlayProps) {
  const [visible, setVisible] = useState(true);

  return (
    <div
      className="absolute inset-0 z-10"
      onClick={() => setVisible((v) => !v)}
    >
      {visible && (
        <>
          {/* 공유 버튼.
              Player의 소리 토글이 top-4 right-4(폭 2.5rem)를 쓰므로 그 왼쪽에 붙인다.
              둘 다 상단 바의 pr-28 안쪽이라 방송자 이름과 겹치지 않는다. */}
          {shareUrl && (
            <ShareButton
              path={shareUrl}
              title={`${streamerName} - ${title}`}
              className="absolute top-[calc(1rem+var(--feed-top-h,0px))] right-16 z-30"
            />
          )}

          {/* 신고. 내 방송에는 띄우지 않는다 */}
          {streamId && !isMe && (
            <ReportButton
              targetType="stream"
              targetId={streamId}
              context={`${streamerName} · ${title}`}
              className="absolute top-[calc(1rem+var(--feed-top-h,0px))] right-28 z-30"
            />
          )}

          {/* Top bar */}
          {/* pr-28: 우상단 소리 토글 버튼과 방송자 이름이 겹치지 않도록.
              --feed-top-h: 피드의 추천/팔로잉 탭이 화면 상단 중앙에 떠 있어서
              그만큼 내려야 방송자 이름과 겹치지 않는다. 탭이 없는 화면
              (/stream/[id])에서는 변수가 없어 0으로 떨어진다 — 하단 탭과
              채팅창을 --bottom-nav-h로 맞추는 것과 같은 방식(ISSUES.md #13). */}
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-4 pr-28 pt-[calc(env(safe-area-inset-top)+var(--feed-top-h,0px))]">
            <div className="flex items-center gap-3">
              {/* Streamer avatar */}
              <ProfileLink streamerId={streamerId}>
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-700">
                  {streamerAvatar ? (
                    <img src={streamerAvatar} alt={streamerName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white">
                      {streamerName[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
              </ProfileLink>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <ProfileLink streamerId={streamerId} className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{streamerName}</p>
                  </ProfileLink>
                  {streamerId && !isMe && (
                    <FollowButton
                      userId={streamerId}
                      initialFollowing={isFollowing}
                      variant="compact"
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <Radio className="h-2.5 w-2.5" />
                    LIVE
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-300">
                    <Eye className="h-3 w-3" />
                    {viewerCount}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 pb-[env(safe-area-inset-bottom)]">
            <p className="text-sm text-white">{title}</p>
            {/* Chat and donation will be added in Phase 5 & 6 */}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 방송자 프로필로 가는 링크.
 *
 * 오버레이 전체가 클릭으로 UI를 토글하므로 stopPropagation이 없으면
 * 프로필로 이동하면서 오버레이가 같이 꺼진다. streamerId가 없으면
 * (아직 붙이지 않은 호출부) 그냥 감싸기만 한다.
 */
function ProfileLink({
  streamerId,
  className = '',
  children,
}: {
  streamerId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!streamerId) return <>{children}</>;

  return (
    <Link
      href={`/u/${streamerId}`}
      onClick={(e) => e.stopPropagation()}
      className={className}
    >
      {children}
    </Link>
  );
}
