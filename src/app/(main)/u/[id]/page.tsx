import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { absoluteUrl } from '@/shared/lib/site-url';
import { PublicProfileView } from '@/domains/user/components/PublicProfileView';

/**
 * 공개 프로필.
 *
 * **URL은 닉네임이 아니라 id다.** 닉네임은 UNIQUE지만 변경 가능해서,
 * 닉네임을 URL로 쓰면 이름을 바꾸는 순간 공유된 링크가 전부 죽는다.
 * 닉네임 기반 주소가 필요해지면 변경 이력 테이블을 두고 리다이렉트해야 한다.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations('user');

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('nickname, bio, avatar_url, follower_count')
    .eq('id', id)
    .single();

  if (!profile) return { title: t('notFound') };

  const title = profile.nickname;
  const description =
    profile.bio ||
    t('ogProfile', {
      count: profile.follower_count,
      nickname: profile.nickname,
    });
  const url = absoluteUrl(`/u/${id}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      title,
      description,
      url,
      images: profile.avatar_url ? [profile.avatar_url] : undefined,
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PublicProfileView id={id} />;
}
