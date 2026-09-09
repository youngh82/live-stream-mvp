import 'server-only';
import Stripe from 'stripe';

/**
 * Stripe 클라이언트. **지연 생성한다** — supabase-admin.ts와 같은 이유다.
 *
 * `next build`는 API 라우트의 설정을 수집하려고 모듈을 import하는데,
 * 그때 클라이언트가 만들어지면 빌드 머신에 시크릿 키가 없어서
 * `Neither apiKey nor config.authenticator provided`로 빌드가 죽는다.
 * 시크릿을 빌드 인자로 넘기면 이미지 히스토리에 그대로 남으므로 답이 아니다.
 */
let client: Stripe | null = null;

function getClient(): Stripe {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('stripe: STRIPE_SECRET_KEY 가 없습니다');

  client = new Stripe(key);
  return client;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getClient(), prop, receiver);
    return typeof value === 'function' ? value.bind(getClient()) : value;
  },
});
