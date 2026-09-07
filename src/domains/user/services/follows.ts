import { createClient } from '@/shared/lib/supabase-server';

/**
 * 주어진 유저들 중 내가 팔로우 중인 집합.
 *
 * 목록 화면에서 팔로우 버튼마다 요청을 날리면 화면 하나에 N번 왕복한다.
 * 한 번의 `.in()` 쿼리로 끝낸다.
 *
 * 세션 클라이언트를 쓰는 이유: RLS가 "내" 행만 보이도록 이미 보장하므로
 * 다른 사람의 팔로우 관계가 섞여 나올 수 없다.
 */
export async function getFollowingSet(
  userIds: string[],
): Promise<{ viewerId: string | null; following: Set<string> }> {
  const empty = { viewerId: null, following: new Set<string>() };
  if (userIds.length === 0) return empty;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return empty;

  const { data } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', user.id)
    .in('following_id', [...new Set(userIds)]);

  return {
    viewerId: user.id,
    following: new Set((data ?? []).map((f) => f.following_id)),
  };
}
