/**
 * 은행 코드 (토스페이먼츠 기준 3자리).
 * https://docs.tosspayments.com/codes/org-codes
 *
 * **은행명은 번역하지 않는다.** 영문 UI에서도 한국 계좌로 보내는 송금이고,
 * 이름이 실제 기관과 어긋나면 사용자가 다른 은행을 고른다. 돈이 잘못 가는
 * 쪽이 화면이 섞여 보이는 쪽보다 훨씬 나쁘다.
 */
export const BANKS: Array<{ code: string; name: string }> = [
  { code: '004', name: 'KB국민은행' },
  { code: '088', name: '신한은행' },
  { code: '020', name: '우리은행' },
  { code: '081', name: '하나은행' },
  { code: '011', name: 'NH농협은행' },
  { code: '012', name: '단위농협' },
  { code: '003', name: 'IBK기업은행' },
  { code: '090', name: '카카오뱅크' },
  { code: '092', name: '토스뱅크' },
  { code: '089', name: '케이뱅크' },
  { code: '023', name: 'SC제일은행' },
  { code: '027', name: '씨티은행' },
  { code: '007', name: 'Sh수협은행' },
  { code: '030', name: '수협중앙회' },
  { code: '002', name: '한국산업은행' },
  { code: '031', name: 'iM뱅크(대구)' },
  { code: '032', name: '부산은행' },
  { code: '039', name: '경남은행' },
  { code: '034', name: '광주은행' },
  { code: '037', name: '전북은행' },
  { code: '035', name: '제주은행' },
  { code: '045', name: '새마을금고' },
  { code: '048', name: '신협' },
  { code: '050', name: '저축은행중앙회' },
  { code: '064', name: '산림조합' },
  { code: '071', name: '우체국예금보험' },
  { code: '054', name: 'HSBC' },
];

export const BANK_NAMES: Record<string, string> = Object.fromEntries(
  BANKS.map((b) => [b.code, b.name]),
);

export const BUSINESS_TYPES = [
  'INDIVIDUAL',
  'INDIVIDUAL_BUSINESS',
  'CORPORATE',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/**
 * 상태 코드는 토스가 주는 값이라 고정이고, **색만 여기서 정한다.**
 * 표시 문구는 `payout.accountStatus_*` / `payout.payoutStatus_*` 메시지에 있다.
 */
export type StatusTone = 'ok' | 'warn' | 'bad';

export const ACCOUNT_STATUS_TONES: Record<string, StatusTone> = {
  APPROVAL_REQUIRED: 'warn',
  PARTIALLY_APPROVED: 'ok',
  KYC_REQUIRED: 'bad',
  APPROVED: 'ok',
};

export const PAYOUT_STATUS_TONES: Record<string, StatusTone> = {
  REQUESTED: 'warn',
  IN_PROGRESS: 'warn',
  COMPLETED: 'ok',
  FAILED: 'bad',
  CANCELED: 'bad',
};

/**
 * 은행 오류로 지급이 실패하는 케이스를 재현하는 테스트 계좌.
 * 토스 문서에 명시된 값이다. 테스트 환경에서만 쓴다.
 */
export const FAILURE_TEST_ACCOUNTS = [
  { bankCode: '295', accountNumber: '77701777777', bank: '우리종합금융' },
  { bankCode: '011', accountNumber: '3025353430761', bank: '농협' },
  { bankCode: '002', accountNumber: '02004240994312', bank: '산업은행' },
];
