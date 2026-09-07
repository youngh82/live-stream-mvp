'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Eye, Loader2, Radio, User } from 'lucide-react';
import { FollowButton } from '@/domains/user/components/FollowButton';
import { ShareButton } from '@/shared/components/ShareButton';
import { BottomNav } from '@/shared/components/BottomNav';

interface PublicProfile {
  id: string;
  nickname: string;
  avatar_url: string | null;
  bio: string | null;
  role: string;
  follower_count: number;
  is_following: boolean;
  is_me: boolean;
  live_stream: {
    id: string;
    title: string;
    viewer_count: number;
    thumbnail_url: string | null;
  } | null;
  recent_streams: {
    id: string;
    title: string;
    category: string | null;
    thumbnail_url: string | null;
    ended_at: string | null;
  }[];
}

export function PublicProfileView({ id }: { id: string }) {
  const t = useTranslations('user');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/users/${id}`)
      .then((res) => (res.ok ? res.json() : { data: null }))
      .then(({ data }) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <>
        <div className="flex min-h-dvh items-center justify-center bg-gray-950">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
        <BottomNav />
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-gray-950">
          <User className="h-12 w-12 text-gray-600" />
          <p className="text-gray-400">{t('notFound')}</p>
        </div>
        <BottomNav />
      </>
    );
  }

  return (
    <>
      <div className="min-h-dvh bg-gray-950 text-white">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <header className="flex items-start gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-gray-800">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={profile.nickname}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold">
                  {profile.nickname[0]?.toUpperCase()}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold">{profile.nickname}</h1>
              <p className="mt-0.5 text-sm text-gray-400">
                {t('followers')}{' '}
                <span className="font-semibold text-white">
                  {profile.follower_count.toLocaleString()}
                </span>
              </p>

              <div className="mt-3 flex items-center gap-2">
                {/* 본인 프로필에는 팔로우 버튼을 띄우지 않는다.
                    서버도 자기 자신 팔로우를 400으로 막지만, 애초에 누를 수
                    있는 것처럼 보이면 안 된다. */}
                {!profile.is_me && (
                  <FollowButton
                    userId={profile.id}
                    initialFollowing={profile.is_following}
                    initialCount={profile.follower_count}
                  />
                )}
                <ShareButton
                  path={`/u/${profile.id}`}
                  title={`${profile.nickname} - Live Stream`}
                  className="!bg-white/10 hover:!bg-white/20"
                />
              </div>
            </div>
          </header>

          {profile.bio && (
            <p className="mt-5 text-sm whitespace-pre-wrap text-gray-300">
              {profile.bio}
            </p>
          )}

          {profile.live_stream && (
            <Link
              href={`/stream/${profile.live_stream.id}`}
              className="mt-6 flex items-center gap-3 rounded-xl bg-red-500/10 p-4 ring-1 ring-red-500/30 transition-colors hover:bg-red-500/20"
            >
              <span className="flex items-center gap-1 rounded bg-red-500 px-2 py-1 text-[10px] font-bold">
                <Radio className="h-3 w-3" />
                LIVE
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {profile.live_stream.title}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-gray-300">
                <Eye className="h-3 w-3" />
                {profile.live_stream.viewer_count}
              </span>
            </Link>
          )}

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-gray-400">
              {t('pastStreams')}
            </h2>
            {profile.recent_streams.length === 0 ? (
              <p className="text-sm text-gray-600">{t('noPastStreams')}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {profile.recent_streams.map((s) => (
                  <li key={s.id} className="overflow-hidden rounded-lg bg-gray-900">
                    {/* 9:16 세로 비율. 피드와 같은 규칙으로 cover다 (ISSUES.md #16) */}
                    <div className="aspect-[9/16] bg-gray-800">
                      {s.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.thumbnail_url}
                          alt={s.title}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <p className="truncate px-2 py-2 text-xs text-gray-300">
                      {s.title}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="h-20" />
        </div>
      </div>
      <BottomNav />
    </>
  );
}
