'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Payout, PayoutAccount, PayoutBalance } from '../types';

interface AccountResponse {
  account: {
    provider: string;
    provider_seller_id: string | null;
    business_type: string;
    status: string;
    bank_code: string;
    account_masked: string;
    holder_name: string;
  } | null;
  /** 지급대행 API 키가 서버에 설정되어 있는지. 사업자 인증 전에는 false */
  configured: boolean;
}

export function usePayout() {
  const t = useTranslations('payout');
  const [balance, setBalance] = useState<
    (PayoutBalance & { holdDays: number }) | null
  >(null);
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [configured, setConfigured] = useState(true);
  const [history, setHistory] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 이펙트에서 동기적으로 setState를 부르면 연쇄 렌더가 생긴다.
  // fetchAll은 상태 갱신을 await 뒤로만 미루고, 로딩 표시는 호출부가 맡는다.
  const fetchAll = useCallback(async () => {
    try {
      const [balanceRes, accountRes, historyRes] = await Promise.all([
        fetch('/api/payout/balance').then((r) => r.json()),
        fetch('/api/payout/account').then((r) => r.json()),
        fetch('/api/payout/history').then((r) => r.json()),
      ]);

      if (!balanceRes.error) setBalance(balanceRes);

      const a = (accountRes as AccountResponse).account;
      setConfigured((accountRes as AccountResponse).configured ?? true);
      setAccount(
        a
          ? {
              userId: '',
              provider: a.provider,
              providerSellerId: a.provider_seller_id,
              businessType: a.business_type as PayoutAccount['businessType'],
              status: a.status as PayoutAccount['status'],
              bankCode: a.bank_code,
              accountMasked: a.account_masked,
              holderName: a.holder_name,
            }
          : null,
      );

      setHistory(
        (historyRes.items ?? []).map(
          (p: Record<string, unknown>): Payout => ({
            id: p.id as string,
            refPayoutId: p.ref_payout_id as string,
            providerPayoutId: null,
            grossAmount: p.gross_amount as number,
            feeAmount: p.fee_amount as number,
            withholdingAmount: p.withholding_amount as number,
            netAmount: p.net_amount as number,
            feeRate: Number(p.fee_rate),
            status: p.status as Payout['status'],
            scheduleType: p.schedule_type as Payout['scheduleType'],
            payoutDate: (p.payout_date as string) ?? null,
            errorCode: null,
            errorMessage: (p.error_message as string) ?? null,
            requestedAt: p.requested_at as string,
            completedAt: (p.completed_at as string) ?? null,
          }),
        ),
      );
    } catch {
      setError(t('loadFailed'));
    }
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await fetchAll();
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    (async () => {
      await fetchAll();
      setLoading(false);
    })();
  }, [fetchAll]);

  /** 계좌 등록. 성공하면 본인인증 안내 여부를 돌려준다. */
  const registerAccount = useCallback(
    async (payload: unknown) => {
      setError(null);
      const res = await fetch('/api/payout/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? t('registerFailed'));
        return null;
      }
      await load();
      return body as { status: string; needsVerification: boolean };
    },
    [load, t],
  );

  const requestPayout = useCallback(
    async (amount: number) => {
      setError(null);
      const res = await fetch('/api/payout/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? t('requestFailed'));
        return null;
      }
      await load();
      return body as { payoutId: string; net: number; payoutDate: string };
    },
    [load, t],
  );

  return {
    balance,
    account,
    configured,
    history,
    loading,
    error,
    setError,
    reload: load,
    registerAccount,
    requestPayout,
  };
}
