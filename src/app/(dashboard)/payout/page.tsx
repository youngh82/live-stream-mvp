'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/domains/auth/hooks/useAuth';
import { usePayout } from '@/domains/payout/hooks/usePayout';
import {
  calculateFees,
  FEE_RATE,
  MIN_PAYOUT,
} from '@/domains/payout/services/fees';
import {
  ACCOUNT_STATUS_TONES,
  BANKS,
  BANK_NAMES,
  BUSINESS_TYPES,
  PAYOUT_STATUS_TONES,
} from '@/domains/payout/constants';
import type { PayoutBusinessType } from '@/domains/payout/types';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, AlertTriangle, Info } from 'lucide-react';

export default function PayoutPage() {
  const t = useTranslations('payout');
  const format = useFormatter();

  /**
   * 금액 표기. 통화는 항상 원화(실제 지급 통화)이고 자릿수 구분만
   * 로케일을 따른다 — 환율 변환이 아니다.
   */
  const won = (n: number) => format.number(n);

  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const {
    balance,
    account,
    configured,
    history,
    loading,
    error,
    setError,
    registerAccount,
    requestPayout,
  } = usePayout();

  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const gross = Number(amount.replace(/\D/g, '')) || 0;
  const preview = useMemo(
    () => calculateFees(gross, account?.businessType ?? 'INDIVIDUAL'),
    [gross, account?.businessType],
  );

  const canRequest =
    account &&
    ['PARTIALLY_APPROVED', 'APPROVED'].includes(account.status) &&
    gross >= MIN_PAYOUT &&
    gross <= (balance?.available ?? 0);

  const handleRequest = async () => {
    if (!canRequest || submitting) return;
    if (
      !confirm(
        t('requestConfirm', {
          gross: won(gross),
          net: won(preview.net),
          holder: account?.holderName ?? '',
        }),
      )
    ) {
      return;
    }
    setSubmitting(true);
    const result = await requestPayout(gross);
    setSubmitting(false);
    if (result) {
      setAmount('');
      setNotice(t('requestSubmitted', { date: result.payoutDate }));
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-950">
        <Loader2 className="h-7 w-7 animate-spin text-white" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-950">
        <p className="text-gray-400">{t('loginRequired')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-950 pb-16 text-white">
      <header className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => router.push('/dashboard')} aria-label={t('back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">{t('title')}</h1>
      </header>

      <div className="mx-auto max-w-lg space-y-5 px-5">
        {!configured && (
          <Banner tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
            {t.rich('notConfigured', {
              code: (chunks) => <code>{chunks}</code>,
            })}
          </Banner>
        )}

        {error && (
          <Banner tone="bad" icon={<AlertTriangle className="h-4 w-4" />}>
            {error}
          </Banner>
        )}
        {notice && (
          <Banner tone="ok" icon={<Info className="h-4 w-4" />}>
            {notice}
          </Banner>
        )}

        {/* 잔액 */}
        <section className="rounded-2xl bg-gray-900 p-5">
          <p className="text-xs text-gray-400">{t('available')}</p>
          <p className="mt-1 text-3xl font-bold">
            {won(balance?.available ?? 0)}
            <span className="ml-1 text-lg font-medium text-gray-400">P</span>
          </p>

          <dl className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-sm">
            <Row
              label={t('totalRevenue')}
              value={`${won(balance?.revenue ?? 0)}P`}
            />
            <Row
              label={t('onHold', { days: balance?.holdDays ?? 14 })}
              value={`${won(balance?.held ?? 0)}P`}
              muted
            />
            <Row
              label={t('inProgress')}
              value={`${won(balance?.pending ?? 0)}P`}
              muted
            />
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
            {t('holdExplainer', { days: balance?.holdDays ?? 14 })}
          </p>
        </section>

        {/* 계좌 */}
        {account ? (
          <section className="rounded-2xl bg-gray-900 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t('payoutAccount')}</h2>
              <StatusChip
                label={
                  ACCOUNT_STATUS_TONES[account.status]
                    ? t(`accountStatus_${account.status}`)
                    : account.status
                }
                tone={ACCOUNT_STATUS_TONES[account.status] ?? 'warn'}
              />
            </div>
            <p className="text-sm text-gray-300">
              {BANK_NAMES[account.bankCode] ?? account.bankCode}{' '}
              {account.accountMasked}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {account.holderName} ·{' '}
              {t(`businessType_${account.businessType}`)}
            </p>

            {account.status === 'APPROVAL_REQUIRED' && (
              <p className="mt-3 rounded-lg bg-yellow-500/10 px-3 py-2 text-xs leading-relaxed text-yellow-300">
                {t('approvalRequiredHint')}
              </p>
            )}
            {account.status === 'KYC_REQUIRED' && (
              <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-300">
                {t('kycRequiredHint')}
              </p>
            )}
          </section>
        ) : (
          <AccountForm onSubmit={registerAccount} onError={setError} />
        )}

        {/* 환전 신청 */}
        {account && (
          <section className="rounded-2xl bg-gray-900 p-5">
            <h2 className="mb-3 font-semibold">{t('requestTitle')}</h2>

            <input
              inputMode="numeric"
              value={amount ? won(gross) : ''}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('minimum', { amount: won(MIN_PAYOUT) })}
              className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-right text-lg font-semibold text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none"
            />

            <div className="mt-2 flex gap-2">
              {[10_000, 50_000, 100_000].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  className="flex-1 rounded-lg bg-white/10 py-2 text-xs text-gray-300"
                >
                  {won(v)}
                </button>
              ))}
              <button
                onClick={() => setAmount(String(balance?.available ?? 0))}
                className="flex-1 rounded-lg bg-white/10 py-2 text-xs text-gray-300"
              >
                {t('all')}
              </button>
            </div>

            {gross > 0 && (
              <dl className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-sm">
                <Row
                  label={t('requestedAmount')}
                  value={`${won(preview.gross)}P`}
                />
                <Row
                  label={t('platformFee', {
                    rate: (preview.feeRate * 100).toFixed(0),
                  })}
                  value={`-${t('krw', { amount: won(preview.fee) })}`}
                  muted
                />
                {preview.withholding > 0 && (
                  <Row
                    label={t('withholding', {
                      rate: (preview.withholdingRate * 100).toFixed(1),
                    })}
                    value={`-${t('krw', { amount: won(preview.withholding) })}`}
                    muted
                  />
                )}
                <div className="flex justify-between border-t border-white/10 pt-2 font-bold">
                  <span>{t('netPayout')}</span>
                  <span className="text-purple-300">
                    {t('krw', { amount: won(preview.net) })}
                  </span>
                </div>
              </dl>
            )}

            <button
              onClick={handleRequest}
              disabled={!canRequest || submitting}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 py-3.5 font-bold disabled:opacity-40"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('requestTitle')}
            </button>

            <p className="mt-2 text-center text-[11px] text-gray-500">
              {t('nextBusinessDay')}
            </p>
          </section>
        )}

        {/* 내역 */}
        {history.length > 0 && (
          <section className="rounded-2xl bg-gray-900 p-5">
            <h2 className="mb-3 font-semibold">{t('historyTitle')}</h2>
            <ul className="space-y-3">
              {history.map((p) => {
                const status = {
                  label: PAYOUT_STATUS_TONES[p.status]
                    ? t(`payoutStatus_${p.status}`)
                    : p.status,
                  tone: PAYOUT_STATUS_TONES[p.status] ?? ('warn' as const),
                };
                return (
                  <li
                    key={p.id}
                    className="flex items-start justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {t('krw', { amount: won(p.netAmount) })}
                        <span className="ml-1.5 text-xs font-normal text-gray-500">
                          {t('requestedNote', { amount: won(p.grossAmount) })}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {format.dateTime(new Date(p.requestedAt), 'short')}
                        {p.payoutDate && ` · ${t('paidOn', { date: p.payoutDate })}`}
                      </p>
                      {p.errorMessage && (
                        <p className="mt-1 text-[11px] text-red-400">
                          {p.errorMessage}
                        </p>
                      )}
                    </div>
                    <StatusChip {...status} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <p className="px-1 text-[11px] leading-relaxed text-gray-600">
          {t('feeDisclaimer', { rate: (FEE_RATE * 100).toFixed(0) })}
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? 'text-gray-500' : 'text-gray-400'}>{label}</dt>
      <dd className={muted ? 'text-gray-400' : ''}>{value}</dd>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' }) {
  const cls =
    tone === 'ok'
      ? 'bg-green-500/15 text-green-300'
      : tone === 'bad'
        ? 'bg-red-500/15 text-red-300'
        : 'bg-yellow-500/15 text-yellow-300';
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${cls}`}>
      {label}
    </span>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === 'ok'
      ? 'bg-green-500/10 text-green-300'
      : tone === 'bad'
        ? 'bg-red-500/10 text-red-300'
        : 'bg-yellow-500/10 text-yellow-300';
  return (
    <div className={`flex gap-2 rounded-xl px-4 py-3 text-xs leading-relaxed ${cls}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

/** 지급 계좌 등록 폼 */
function AccountForm({
  onSubmit,
  onError,
}: {
  onSubmit: (payload: unknown) => Promise<{ needsVerification: boolean } | null>;
  onError: (msg: string | null) => void;
}) {
  const t = useTranslations('payout');
  const [businessType, setBusinessType] =
    useState<PayoutBusinessType>('INDIVIDUAL');
  const [bankCode, setBankCode] = useState(BANKS[0].code);
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bizNumber, setBizNumber] = useState('');
  const [repName, setRepName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isIndividual = businessType === 'INDIVIDUAL';

  const handle = async () => {
    onError(null);
    setSubmitting(true);
    await onSubmit({
      businessType,
      account: { bankCode, accountNumber, holderName },
      ...(isIndividual
        ? { individual: { name, email, phone } }
        : {
            company: {
              name,
              representativeName: repName,
              businessRegistrationNumber: bizNumber,
              email,
              phone,
            },
          }),
    });
    setSubmitting(false);
  };

  const field =
    'w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none';

  return (
    <section className="rounded-2xl bg-gray-900 p-5">
      <h2 className="mb-1 font-semibold">{t('registerAccount')}</h2>
      <p className="mb-4 text-xs leading-relaxed text-gray-500">
        {t('registerAccountHint')}
      </p>

      <div className="space-y-2.5">
        <div className="flex gap-2">
          {BUSINESS_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setBusinessType(type)}
              className={`flex-1 rounded-lg py-2 text-xs ${
                businessType === type
                  ? 'bg-purple-600 font-semibold'
                  : 'bg-white/10 text-gray-300'
              }`}
            >
              {t(`businessType_${type}`)}
            </button>
          ))}
        </div>

        <input
          className={field}
          placeholder={isIndividual ? t('fieldName') : t('fieldCompanyName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {!isIndividual && (
          <>
            <input
              className={field}
              placeholder={t('fieldRepresentative')}
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
            />
            <input
              className={field}
              inputMode="numeric"
              placeholder={t('fieldBizNumber')}
              value={bizNumber}
              onChange={(e) => setBizNumber(e.target.value)}
            />
          </>
        )}

        <input
          className={field}
          type="email"
          placeholder={t('fieldEmail')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={field}
          inputMode="tel"
          placeholder={t('fieldPhone')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <select
          className={field}
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
        >
          {BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
        <input
          className={field}
          inputMode="numeric"
          placeholder={t('fieldAccountNumber')}
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
        />
        <input
          className={field}
          placeholder={t('fieldHolderName')}
          value={holderName}
          onChange={(e) => setHolderName(e.target.value)}
        />
      </div>

      <button
        onClick={handle}
        disabled={submitting || !accountNumber || !holderName || !name}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 py-3.5 font-bold disabled:opacity-40"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('registerAccountCta')}
      </button>
    </section>
  );
}
