import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { createClient } from '@/shared/lib/supabase-server';

export interface AdminUser {
  id: string;
  nickname: string;
}

/**
 * 운영자 확인.
 *
 * **role은 004의 컬럼 단위 GRANT에 없어서 클라이언트가 못 바꾼다.**
 * 그래서 DB의 role 값을 그대로 신뢰할 수 있다. 세션 JWT의 클레임이 아니라
 * DB를 읽는 이유는, 권한을 회수했을 때 기존 토큰으로 계속 쓰이면 안 되기 때문이다.
 */
export async function requireAdmin(): Promise<AdminUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabaseAdmin
    .from('users')
    .select('id, nickname, role')
    .eq('id', user.id)
    .single();

  if (!data || data.role !== 'admin') return null;
  return { id: data.id, nickname: data.nickname };
}
