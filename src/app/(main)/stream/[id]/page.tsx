import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { absoluteUrl } from '@/shared/lib/site-url';
import { StreamView } from '@/domains/stream/components/StreamView';

/**
 * 공유 링크용 OG 메타데이터.
 *
 * 이게 없으면 카톡·트위터에 방송 링크를 붙였을 때 루트 레이아웃의
 * "Live Stream / 숏폼 세로 라이브 스트리밍"만 뜬다. 제목도 썸네일도 없는
 * 링크는 아무도 누르지 않으므로 유입 경로 하나가 통째로 죽는다.
 *
 * 메타데이터는 크롤러가 보는 것이라 로그인 세션이 없다. RLS를 거치지 않는
 * admin 클라이언트로 읽되 **stream_key는 절대 select하지 않는다.**
 *
 * 크롤러에는 쿠키가 없으므로 여기서의 로케일은 사실상 `Accept-Language`나
 * 기본값으로 정해진다. 링크를 공유한 사람의 언어가 아니라 크롤러의 언어라는
 * 뜻이다 — 로케일별 미리보기가 필요해지면 URL에 로케일이 있어야 한다.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations('stream');

  const { data: stream } = await supabaseAdmin
    .from('streams')
    .select('title, description, status, thumbnail_url, users!inner(nickname)')
    .eq('id', id)
    .single();

  if (!stream) return { title: t('notFound') };

  const streamer = (stream.users as unknown as { nickname: string }).nickname;
  const live = stream.status === 'live';
  const title = `${live ? '🔴 ' : ''}${stream.title} - ${streamer}`;
  const description =
    stream.description ||
    (live ? t('ogLive', { streamer }) : t('ogOffline', { streamer }));
  const url = absoluteUrl(`/stream/${id}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'video.other',
      title,
      description,
      url,
      images: stream.thumbnail_url ? [stream.thumbnail_url] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: stream.thumbnail_url ? [stream.thumbnail_url] : undefined,
    },
  };
}

export default async function StreamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StreamView id={id} />;
}
