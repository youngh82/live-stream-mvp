/**
 * 환전 금액 계산.
 *
 * 이 파일이 금액 계산의 유일한 출처다. 클라이언트는 미리보기용으로 같은
 * 함수를 쓰지만, 실제 차감에 쓰이는 값은 항상 서버가 다시 계산한다.
 *
 * 수수료율을 정한 근거:
 *   원가 = PG 수수료 약 3% + 계좌이체 수수료 300~500원 + 차지백 손실 약 0.5%
 *        → 대략 8~9%. 10% 아래로는 구조적으로 적자다.
 *   업계 = SOOP 60~80%, 유튜브 슈퍼챗 70%, 틱톡 50% 이하 (크리에이터 몫)
 *   웹 기반이라 앱스토어 인앱결제 30%를 내지 않는 구조적 우위가 있다.
 *        네이티브 앱으로 가면 원가가 3% → 33%로 뛴다.
 *
 * 20%로 시작하되 등급제로 낮출 여지를 남긴다. 처음부터 15%로 시작하면
 * 나중에 올릴 수가 없다 — 수수료 인상은 크리에이터가 가장 격렬하게
 * 반응하는 변경이다.
 */

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 플랫폼 수수료율 */
export const FEE_RATE = num(process.env.PAYOUT_FEE_RATE, 0.2);

/**
 * 사업소득 원천징수율 (소득세 3% + 지방소득세 0.3%).
 * 개인·개인사업자에게만 적용된다. 법인은 원천징수 대상이 아니다.
 */
export const WITHHOLDING_RATE = num(process.env.PAYOUT_WITHHOLDING_RATE, 0.033);

/**
 * 홀드 기간(일). 후원 결제가 차지백되면 이미 지급한 돈은 회수하지 못하므로
 * 최근 후원분은 환전 가능액에서 뺀다.
 */
export const HOLD_DAYS = num(process.env.PAYOUT_HOLD_DAYS, 14);

/** 최소 환전 금액. 이체 수수료가 소액 건에서 배보다 배꼽이 된다. */
export const MIN_PAYOUT = num(process.env.PAYOUT_MIN_AMOUNT, 10_000);

export interface FeeBreakdown {
  /** 환전 신청 금액(수익 포인트에서 차감되는 총액) */
  gross: number;
  /** 플랫폼 수수료 */
  fee: number;
  /** 원천징수액 */
  withholding: number;
  /** 실제로 계좌에 입금되는 금액 */
  net: number;
  feeRate: number;
  withholdingRate: number;
}

/**
 * gross = fee + withholding + net 이 항상 성립하도록 계산한다.
 * (DB의 payouts_amount_split 제약이 이걸 검증한다)
 *
 * 원천징수는 수수료를 뗀 나머지(= 실제 소득)에 대해 계산한다.
 */
export function calculateFees(
  gross: number,
  businessType: 'INDIVIDUAL' | 'INDIVIDUAL_BUSINESS' | 'CORPORATE',
): FeeBreakdown {
  const feeRate = FEE_RATE;
  // 법인은 원천징수 대상이 아니다
  const withholdingRate =
    businessType === 'CORPORATE' ? 0 : WITHHOLDING_RATE;

  const fee = Math.floor(gross * feeRate);
  const taxable = gross - fee;
  const withholding = Math.floor(taxable * withholdingRate);
  const net = taxable - withholding;

  return { gross, fee, withholding, net, feeRate, withholdingRate };
}

/** 환전 신청이 가능한 금액인지 확인한다. 실패 사유를 문자열로 돌려준다. */
export function validatePayoutAmount(
  gross: number,
  available: number,
): string | null {
  if (!Number.isInteger(gross) || gross <= 0) {
    return '환전 금액이 올바르지 않습니다';
  }
  if (gross < MIN_PAYOUT) {
    return `최소 환전 금액은 ${MIN_PAYOUT.toLocaleString()}P입니다`;
  }
  if (gross > available) {
    return `환전 가능 금액(${available.toLocaleString()}P)을 초과했습니다`;
  }
  const { net } = calculateFees(gross, 'INDIVIDUAL');
  if (net <= 0) {
    return '수수료를 제하면 지급액이 남지 않습니다';
  }
  return null;
}
