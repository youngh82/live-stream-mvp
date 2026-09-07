/** 지급대행(환전) 도메인 타입 */

export type PayoutBusinessType =
  | 'INDIVIDUAL'
  | 'INDIVIDUAL_BUSINESS'
  | 'CORPORATE';

/**
 * 토스 셀러 상태를 그대로 쓴다.
 * - APPROVAL_REQUIRED: 등록 직후(개인/개인사업자). 본인인증 문자가 발송된다. 지급 불가
 * - PARTIALLY_APPROVED: 주 1천만원 미만 지급 가능
 * - KYC_REQUIRED: 주 1천만원 초과 시도 시. 지급 불가. KYC 심사 필요
 * - APPROVED: 한도 없음
 */
export type PayoutAccountStatus =
  | 'APPROVAL_REQUIRED'
  | 'PARTIALLY_APPROVED'
  | 'KYC_REQUIRED'
  | 'APPROVED';

export type PayoutStatus =
  | 'REQUESTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED';

/** EXPRESS는 당일 지급(영업일 08:00~15:00만), SCHEDULED는 예약 지급 */
export type PayoutScheduleType = 'EXPRESS' | 'SCHEDULED';

export interface PayoutAccount {
  userId: string;
  provider: string;
  providerSellerId: string | null;
  businessType: PayoutBusinessType;
  status: PayoutAccountStatus;
  bankCode: string;
  accountMasked: string;
  holderName: string;
}

export interface Payout {
  id: string;
  refPayoutId: string;
  providerPayoutId: string | null;
  grossAmount: number;
  feeAmount: number;
  withholdingAmount: number;
  netAmount: number;
  feeRate: number;
  status: PayoutStatus;
  scheduleType: PayoutScheduleType;
  payoutDate: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedAt: string;
  completedAt: string | null;
}

export interface PayoutBalance {
  /** 후원으로 받은 수익 총액 */
  revenue: number;
  /** 지금 환전 가능한 금액 (홀드 기간 지난 것) */
  available: number;
  /** 홀드 중이라 아직 환전 못 하는 금액 */
  held: number;
  /** 환전 요청됐지만 아직 지급 완료 안 된 금액 */
  pending: number;
}

/** 계좌 정보. 전체 계좌번호는 등록 요청에만 쓰고 우리 DB에 저장하지 않는다. */
export interface BankAccountInput {
  bankCode: string;
  accountNumber: string;
  holderName: string;
}

export interface RegisterSellerInput {
  refSellerId: string;
  businessType: PayoutBusinessType;
  account: BankAccountInput;
  /** businessType이 INDIVIDUAL일 때 필수 */
  individual?: { name: string; email: string; phone: string };
  /** businessType이 사업자일 때 필수 */
  company?: {
    name: string;
    representativeName: string;
    businessRegistrationNumber: string;
    email: string;
    phone: string;
  };
}

export interface RequestPayoutInput {
  refPayoutId: string;
  /** 공급자가 발급한 셀러 id */
  destination: string;
  /** 실지급액(원). 수수료·원천징수를 뺀 금액 */
  amount: number;
  scheduleType: PayoutScheduleType;
  /** SCHEDULED일 때 필수. YYYY-MM-DD */
  payoutDate?: string;
  description?: string;
}

/**
 * 지급대행 공급자.
 *
 * 국내는 토스 지급대행, 해외는 별도 공급자가 필요하다.
 * 지금 필요한 건 국내뿐이라 구현은 토스 하나만 두고,
 * 해외용은 이 인터페이스만 열어둔다. 구현은 필요해질 때 붙인다.
 */
export interface PayoutProvider {
  readonly name: string;
  registerSeller(
    input: RegisterSellerInput,
  ): Promise<{ sellerId: string; status: PayoutAccountStatus }>;
  getSeller(
    sellerId: string,
  ): Promise<{ sellerId: string; status: PayoutAccountStatus }>;
  requestPayout(
    input: RequestPayoutInput,
  ): Promise<{ payoutId: string; status: PayoutStatus }>;
  cancelPayout(payoutId: string): Promise<void>;
  getBalance(): Promise<{ available: number; pending: number | null }>;
}
