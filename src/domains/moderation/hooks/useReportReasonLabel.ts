'use client';

import { useTranslations } from 'next-intl';
import { REPORT_REASONS, type ReportReason } from '@/domains/moderation/types';

const KNOWN = new Set<string>(REPORT_REASONS);

/**
 * 저장된 신고 사유를 화면 문구로.
 *
 * **모르는 값은 그대로 보여준다.** `reports.reason`은 코드로 바꾸기 전에
 * 쌓인 자유 텍스트 행이 남아 있고, 운영자에게는 그 원문이 판단 근거다.
 * 번역이 없다고 빈 줄로 만들면 근거가 사라진다.
 */
export function useReportReasonLabel() {
  const t = useTranslations('report');

  return (reason: string): string =>
    KNOWN.has(reason) ? t(`reason_${reason as ReportReason}`) : reason;
}
