/**
 * README 스크린샷·GIF용 데모 데이터.
 *
 * 방송자 계정과 `streams` 행을 만든다. **실제 송출은 하지 않는다** —
 * 영상은 `scripts/demo-broadcast.sh`가 ffmpeg로 MediaMTX에 밀어넣고,
 * 그러면 인증→on-publish 웹훅→Redis→피드까지 평소 경로를 그대로 탄다.
 * 여기서 Redis를 직접 건드리면 스크린샷이 실제로 동작하는 파이프라인이
 * 아니라 만들어낸 화면이 된다.
 *
 * 멱등이다. 여러 번 돌려도 계정과 방송이 중복 생성되지 않는다.
 *
 *   pnpm tsx scripts/seed-demo.ts          # 생성/갱신
 *   pnpm tsx scripts/seed-demo.ts --clean  # 전부 삭제
 */
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요하다');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * 데모 계정의 이메일 도메인. 실제로 메일을 받지 못하는 주소다.
 *
 * 계정을 찾을 때 이 도메인이 아니라 **닉네임으로 조회한다.**
 * `auth.admin.listUsers`가 이 프로젝트에서 500("Database error finding
 * users")을 돌려주기 때문이다. `public.users.nickname`은 UNIQUE이고
 * 우리가 값을 정하므로 조회 키로 충분하다.
 */
const DEMO_DOMAIN = 'demo.livestream.local';

/**
 * 데모 계정 공용 비밀번호.
 *
 * 실행마다 새로 만들고 `.demo-streams`(gitignore 대상)에만 적는다.
 * `scripts/demo-chat.ts`가 이 계정들로 로그인해 채팅을 채운다 —
 * 채팅 서버가 JWKS로 서명을 검증해서 토큰을 직접 만들 수 없기 때문에,
 * 실제 로그인 말고는 소켓에 붙을 방법이 없다.
 *
 * 이 계정들은 데모 전용이고 받을 수 없는 도메인을 쓴다.
 */
const DEMO_PASSWORD = `demo-${crypto.randomUUID()}`;

const DEMO_STREAMERS = [
  {
    nickname: 'mina_live',
    title: 'late night lo-fi + taking requests',
    description: 'chill beats, come say hi',
    category: 'music',
    tags: ['lofi', 'requests', 'chill'],
  },
  {
    nickname: 'kkanbu',
    title: 'ranked grind to diamond — day 12',
    description: 'no mic breaks until diamond',
    category: 'game',
    tags: ['ranked', 'fps', 'grind'],
  },
  {
    nickname: 'seoul_eats',
    title: 'gwangjang market food tour',
    description: 'walking and eating through the market',
    category: 'food',
    tags: ['streetfood', 'seoul', 'irl'],
  },
  {
    nickname: 'studywithdana',
    title: 'study with me — 50/10 pomodoro',
    description: 'silent focus room, timer on screen',
    category: 'study',
    tags: ['pomodoro', 'focus', 'silent'],
  },
  {
    nickname: 'inkline',
    title: 'inking a full page, start to finish',
    description: 'brush pen + a lot of coffee',
    category: 'art',
    tags: ['illustration', 'inking', 'process'],
  },
];

const NICKNAMES = DEMO_STREAMERS.map((d) => d.nickname);

async function findDemoUsers() {
  const { data, error } = await admin
    .from('users')
    .select('id, nickname')
    .in('nickname', NICKNAMES);
  if (error) throw error;
  return data;
}

async function clean() {
  const users = await findDemoUsers();
  for (const user of users) {
    // streams는 ON DELETE CASCADE라 계정만 지우면 방송도 같이 사라진다
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) console.error(`  ✗ ${user.nickname}: ${error.message}`);
    else console.log(`  ✓ removed ${user.nickname}`);
  }
  console.log(`\n${users.length}개 데모 계정을 삭제했다.`);
}

async function seed() {
  const existing = await findDemoUsers();
  const byNickname = new Map(existing.map((u) => [u.nickname, u.id]));

  const rows: Array<{ nickname: string; streamId: string; streamKey: string }> = [];

  for (const demo of DEMO_STREAMERS) {
    const email = `${demo.nickname}@${DEMO_DOMAIN}`;
    let userId = byNickname.get(demo.nickname);

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        // 데모 전용 계정이고 로그인 용도가 아니다. 이 도메인은 실제로
        // 메일을 받지 못하므로 확인 메일을 보낼 수도 없다.
        email_confirm: true,
        password: DEMO_PASSWORD,
        user_metadata: { nickname: demo.nickname },
      });
      if (error) {
        console.error(`  ✗ ${demo.nickname}: ${error.message}`);
        continue;
      }
      userId = data.user.id;
    } else {
      // 이미 있는 계정도 이번 실행의 비밀번호로 맞춰준다. 안 그러면
      // 두 번째 실행부터 demo-chat.ts가 로그인하지 못한다.
      await admin.auth.admin.updateUserById(userId, {
        password: DEMO_PASSWORD,
      });
    }

    await admin.from('users').update({ role: 'streamer' }).eq('id', userId);

    // 방송자당 하나만 둔다. 이미 있으면 제목·카테고리만 갱신한다.
    const { data: found } = await admin
      .from('streams')
      .select('id, stream_key')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    let streamId = found?.id;
    let streamKey = found?.stream_key;

    // `/api/stream/auth`가 하이픈 포함 UUID 형태만 stream_key로 인정한다.
    // 다른 모양이면 인증이 조용히 401로 떨어지므로 여기서 맞춰둔다.
    const isUuid =
      !!streamKey &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        streamKey,
      );

    if (!streamId) {
      const { data, error } = await admin
        .from('streams')
        .insert({
          user_id: userId,
          title: demo.title,
          description: demo.description,
          category: demo.category,
          tags: demo.tags,
          stream_key: crypto.randomUUID(),
        })
        .select('id, stream_key')
        .single();
      if (error) {
        console.error(`  ✗ ${demo.nickname} stream: ${error.message}`);
        continue;
      }
      streamId = data.id;
      streamKey = data.stream_key;
    } else {
      if (!isUuid) streamKey = crypto.randomUUID();
      await admin
        .from('streams')
        .update({
          title: demo.title,
          description: demo.description,
          category: demo.category,
          tags: demo.tags,
          stream_key: streamKey,
        })
        .eq('id', streamId);
    }

    rows.push({ nickname: demo.nickname, streamId: streamId!, streamKey: streamKey! });
    console.log(`  ✓ ${demo.nickname.padEnd(16)} ${streamId}`);
  }

  await seedReports(rows);

  console.log(`\n${rows.length}명 준비됨. 송출은 아래로 시작한다:\n`);
  console.log('  bash scripts/demo-broadcast.sh start\n');

  // demo-broadcast.sh가 읽는다. 키가 들어 있으므로 커밋하지 않는다.
  const manifest = [
    `# password\t${DEMO_PASSWORD}`,
    `# domain\t${DEMO_DOMAIN}`,
    ...rows.map((r) => `${r.nickname}\t${r.streamId}\t${r.streamKey}`),
  ].join('\n');
  await writeFile('.demo-streams', manifest + '\n', 'utf8');
  console.log('  → .demo-streams 에 기록했다 (gitignore 대상)');
}

/**
 * 운영자 화면(`/admin`)이 비어 있지 않도록 데모 신고를 넣는다.
 *
 * 신고 사유는 화면 문구가 아니라 코드로 저장한다 —
 * `REPORT_REASONS`(moderation/types.ts)와 같은 값이어야 운영자 화면에서
 * 번역되어 보인다.
 *
 * 대상은 데모 방송이고 신고자도 데모 계정이라, `--clean`이 계정을 지우면
 * CASCADE로 같이 사라진다.
 */
async function seedReports(
  rows: Array<{ nickname: string; streamId: string }>,
) {
  if (rows.length < 2) return;

  // 한 대상에 여러 명이 신고한 모양을 만든다. 운영자 화면이 신고를
  // 대상별로 묶어서 "몇 명이 신고했는가"로 줄 세우기 때문에,
  // 한 명이 여러 건 넣으면 그 화면의 요점이 드러나지 않는다.
  const target = rows[rows.length - 1];
  const reporters = rows.slice(0, 3);
  const reasons = ['harassment', 'harassment', 'sexual'];

  const { data: users } = await admin
    .from('users')
    .select('id, nickname')
    .in(
      'nickname',
      reporters.map((r) => r.nickname),
    );
  const idByNickname = new Map((users ?? []).map((u) => [u.nickname, u.id]));

  const payload = reporters.map((reporter, i) => ({
    reporter_id: idByNickname.get(reporter.nickname)!,
    target_type: 'stream' as const,
    target_id: target.streamId,
    reason: reasons[i],
    context: `${target.nickname} — demo stream`,
  }));

  // (reporter_id, target_type, target_id)가 UNIQUE라 재실행하면 충돌한다.
  // 중복은 무시하고 넘어간다 — 시드는 몇 번을 돌려도 같은 상태여야 한다.
  const { error } = await admin
    .from('reports')
    .upsert(payload, { onConflict: 'reporter_id,target_type,target_id' });

  if (error) console.error(`  ✗ reports: ${error.message}`);
  else console.log(`  ✓ ${payload.length} demo reports on ${target.nickname}`);
}

const mode = process.argv.includes('--clean') ? 'clean' : 'seed';
(mode === 'clean' ? clean() : seed()).catch((err) => {
  console.error(err);
  process.exit(1);
});
