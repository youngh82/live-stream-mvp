import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service role client — RLS를 우회한다. 서버 코드에서만 쓸 것.
 *
 * **지연 생성한다.** 예전에는 모듈 로드 시점에 만들었는데, `next build`가
 * 각 API 라우트의 설정을 수집하려고 모듈을 import하는 순간 클라이언트가
 * 만들어지면서 `supabaseKey is required`로 빌드가 죽었다. 빌드 머신에는
 * 서비스 키가 없기 때문이다.
 *
 * **키를 빌드 인자로 넘기는 것은 해법이 아니다** — build arg는 이미지
 * 레이어와 히스토리에 그대로 남아, 이미지를 받은 사람이 전부 꺼내볼 수 있다.
 * 시크릿은 런타임 환경변수로만 들어온다.
 *
 * Proxy로 감싼 이유는 호출부 36곳이 `supabaseAdmin.from(...)` 형태를
 * 그대로 쓰게 두기 위해서다.
 */
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'supabaseAdmin: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다',
    );
  }

  client = createClient(url, key);
  return client;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getClient(), prop, receiver);
    // from()/rpc() 같은 메서드는 내부에서 this를 쓴다. 원본에 묶어준다.
    return typeof value === 'function' ? value.bind(getClient()) : value;
  },
});
