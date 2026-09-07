import {
  tossPayoutApi,
  TossPayoutError,
  isPayoutConfigured,
} from '@/shared/lib/toss-payout';
import type {
  PayoutAccountStatus,
  PayoutProvider,
  PayoutStatus,
  RegisterSellerInput,
  RequestPayoutInput,
} from '../types';

/** 토스가 돌려주는 Seller 객체 중 우리가 쓰는 부분 */
interface TossSeller {
  id: string;
  refSellerId: string | null;
  status: PayoutAccountStatus;
}

interface TossPayoutItem {
  id: string;
  refPayoutId: string;
  status: PayoutStatus;
  error: { code?: string; message?: string } | null;
}

interface TossPayoutList {
  items: TossPayoutItem[];
}

interface TossBalance {
  availableAmount?: { currency: string; value: number };
  pendingAmount?: { currency: string; value: number };
}

/**
 * 토스페이먼츠 지급대행 (국내).
 *
 * 셀러 등록 → 본인인증(개인·개인사업자) → 지급 요청 흐름이다.
 * 상태 변화는 폴링하지 말고 seller.changed / payout.changed 웹훅으로 받는다.
 */
export const tossPayoutProvider: PayoutProvider = {
  name: 'toss',

  async registerSeller(input: RegisterSellerInput) {
    const seller = await tossPayoutApi.createSeller<TossSeller>({
      refSellerId: input.refSellerId,
      businessType: input.businessType,
      ...(input.company ? { company: input.company } : {}),
      ...(input.individual ? { individual: input.individual } : {}),
      account: {
        bankCode: input.account.bankCode,
        accountNumber: input.account.accountNumber,
        holderName: input.account.holderName,
      },
    });

    return { sellerId: seller.id, status: seller.status };
  },

  async getSeller(sellerId: string) {
    const seller = await tossPayoutApi.getSeller<TossSeller>(sellerId);
    return { sellerId: seller.id, status: seller.status };
  },

  async requestPayout(input: RequestPayoutInput) {
    // 한 번에 최대 100건까지 배치로 보낼 수 있지만 지금은 건별로 보낸다.
    // 배치 중 한 건이라도 실패하면 전체가 실패하고 첫 에러만 돌아오기 때문에,
    // 사용자별 환전 요청을 묶으면 한 명 때문에 전부 막힌다.
    const result = await tossPayoutApi.createPayouts<TossPayoutList>(
      [
        {
          refPayoutId: input.refPayoutId,
          destination: input.destination,
          scheduleType: input.scheduleType,
          ...(input.payoutDate ? { payoutDate: input.payoutDate } : {}),
          amount: { currency: 'KRW', value: input.amount },
          ...(input.description
            ? { transactionDescription: input.description }
            : {}),
        },
      ],
      // 멱등키. 같은 환전 요청이 두 번 가도 중복 지급되지 않는다.
      input.refPayoutId,
    );

    const item = result.items?.[0];
    if (!item) {
      throw new TossPayoutError('NO_PAYOUT_RETURNED', '지급 요청 결과가 비어 있습니다', 502);
    }

    return { payoutId: item.id, status: item.status };
  },

  async cancelPayout(payoutId: string) {
    await tossPayoutApi.cancelPayout(payoutId);
  },

  async getBalance() {
    const balance = await tossPayoutApi.getBalance<TossBalance>();
    return {
      available: balance.availableAmount?.value ?? 0,
      // 테스트 환경에서는 availableAmount만 돌아온다
      pending: balance.pendingAmount?.value ?? null,
    };
  },
};

/**
 * 지급대행 공급자 선택.
 *
 * 지금은 국내(토스)만 구현되어 있다. 해외 지급은 별도 공급자가 필요하고
 * (Stripe Connect가 이미 쓰는 Stripe와 붙어 자연스럽다) 인터페이스만
 * 열어둔 상태다 — 실제로 필요해질 때 여기에 분기를 추가한다.
 */
export function getPayoutProvider(region: 'KR' | 'GLOBAL' = 'KR'): PayoutProvider {
  if (region === 'GLOBAL') {
    throw new TossPayoutError(
      'PROVIDER_NOT_IMPLEMENTED',
      '해외 지급대행은 아직 연동되지 않았습니다',
      501,
    );
  }
  return tossPayoutProvider;
}

export { isPayoutConfigured };
