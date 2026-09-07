/**
 * 유저 역할 변경 (로컬 운영용).
 *
 * `users.role`은 004의 컬럼 단위 GRANT에서 빠져 있어 클라이언트가 바꿀 수
 * 없다 — 열어두면 누구나 스스로를 운영자로 만들 수 있기 때문이다.
 * 그래서 첫 운영자는 서버 권한으로만 지정할 수 있고, 이 스크립트가 그 자리다.
 *
 *   npx tsx scripts/set-role.ts <nickname> <viewer|streamer|admin>
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const ROLES = ['viewer', 'streamer', 'admin'] as const;

const [nickname, role] = process.argv.slice(2);

if (!nickname || !ROLES.includes(role as (typeof ROLES)[number])) {
  console.error('usage: npx tsx scripts/set-role.ts <nickname> <viewer|streamer|admin>');
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const { data, error } = await admin
    .from('users')
    .update({ role })
    .eq('nickname', nickname)
    .select('nickname, role')
    .single();

  if (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
  console.log(`✓ ${data.nickname} → ${data.role}`);
}

main();
