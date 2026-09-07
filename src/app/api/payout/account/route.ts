import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import {
  getPayoutProvider,
  isPayoutConfigured,
} from '@/domains/payout/services/toss-provider';
import { TossPayoutError } from '@/shared/lib/toss-payout';
import type { PayoutBusinessType } from '@/domains/payout/types';

const BUSINESS_TYPES: PayoutBusinessType[] = [
  'INDIVIDUAL',
  'INDIVIDUAL_BUSINESS',
  'CORPORATE',
];

/** 계좌번호는 우리 DB에 남기지 않는다. 표시용 마스킹만 저장한다. */
function maskAccount(accountNumber: string): string {
  if (accountNumber.length <= 6) return '*'.repeat(accountNumber.length);
  return `${accountNumber.slice(0, 3)}${'*'.repeat(accountNumber.length - 6)}${accountNumber.slice(-3)}`;
}

/**
 * refSellerId는 등록 후 수정할 수 없고 7~20자 제약이 있다.
 * user id(UUID 36자)를 그대로 못 쓰므로 하이픈을 뺀 앞 20자를 쓴다.
 */
function refSellerIdFor(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 20);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  }

  const { data } = await supabaseAdmin
    .from('payout_accounts')
    .select(
      'provider, provider_seller_id, business_type, status, bank_code, account_masked, holder_name, created_at',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    account: data ?? null,
    configured: isPayoutConfigured(),
  });
}

/**
 * 지급 계좌 등록.
 *
 * 토스에 셀러로 등록하면서 사업자번호·계좌 유효성이 검증된다.
 * 개인/개인사업자는 등록 직후 APPROVAL_REQUIRED 상태이고, 입력한 전화번호로
 * 본인인증 문자가 발송된다. 인증을 마쳐야 PARTIALLY_APPROVED가 되어
 * 주 1천만원 미만 지급이 가능해진다. 상태 변화는 웹훅으로 받는다.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const body = await request.json();
    const { businessType, account, individual, company } = body ?? {};

    if (!BUSINESS_TYPES.includes(businessType)) {
      return NextResponse.json(
        { error: '사업자 유형이 올바르지 않습니다' },
        { status: 400 },
      );
    }

    const bankCode = String(account?.bankCode ?? '').trim();
    const accountNumber = String(account?.accountNumber ?? '').replace(/\D/g, '');
    const holderName = String(account?.holderName ?? '').trim();

    if (!bankCode || !accountNumber || !holderName) {
      return NextResponse.json(
        { error: '은행, 계좌번호, 예금주를 모두 입력해주세요' },
        { status: 400 },
      );
    }
    if (accountNumber.length > 14) {
      return NextResponse.json(
        { error: '계좌번호는 14자리 이하여야 합니다' },
        { status: 400 },
      );
    }

    if (businessType === 'INDIVIDUAL') {
      if (!individual?.name || !individual?.email || !individual?.phone) {
        return NextResponse.json(
          { error: '이름, 이메일, 전화번호를 입력해주세요' },
          { status: 400 },
        );
      }
    } else if (
      !company?.name ||
      !company?.representativeName ||
      !company?.businessRegistrationNumber ||
      !company?.email ||
      !company?.phone
    ) {
      return NextResponse.json(
        { error: '사업자 정보를 모두 입력해주세요' },
        { status: 400 },
      );
    }

    // 이미 등록된 계좌가 있으면 재등록을 막는다.
    // refSellerId는 수정 불가라 셀러를 새로 만들 수 없고, 계좌 변경은
    // 셀러 수정 API로 해야 한다 (PATCH에서 처리).
    const { data: existing } = await supabaseAdmin
      .from('payout_accounts')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: '이미 등록된 계좌가 있습니다. 계좌 변경을 이용해주세요' },
        { status: 409 },
      );
    }

    const provider = getPayoutProvider('KR');
    const refSellerId = refSellerIdFor(user.id);

    const phoneDigits = (v: string) => String(v).replace(/\D/g, '');
    const seller = await provider.registerSeller({
      refSellerId,
      businessType,
      account: { bankCode, accountNumber, holderName },
      ...(businessType === 'INDIVIDUAL'
        ? {
            individual: {
              name: String(individual.name).trim(),
              email: String(individual.email).trim(),
              phone: phoneDigits(individual.phone),
            },
          }
        : {
            company: {
              name: String(company.name).trim(),
              representativeName: String(company.representativeName).trim(),
              businessRegistrationNumber: phoneDigits(
                company.businessRegistrationNumber,
              ),
              email: String(company.email).trim(),
              phone: phoneDigits(company.phone),
            },
          }),
    });

    const { error: insertError } = await supabaseAdmin
      .from('payout_accounts')
      .insert({
        user_id: user.id,
        provider: provider.name,
        provider_seller_id: seller.sellerId,
        ref_seller_id: refSellerId,
        business_type: businessType,
        status: seller.status,
        bank_code: bankCode,
        account_masked: maskAccount(accountNumber),
        holder_name: holderName,
      });

    if (insertError) throw insertError;

    return NextResponse.json({
      sellerId: seller.sellerId,
      status: seller.status,
      // 개인·개인사업자는 문자로 온 본인인증을 마쳐야 지급이 가능하다
      needsVerification: seller.status === 'APPROVAL_REQUIRED',
    });
  } catch (error) {
    if (error instanceof TossPayoutError) {
      console.error('[Payout/account] Toss error:', error.code, error.message);
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus >= 400 ? error.httpStatus : 502 },
      );
    }
    console.error('[Payout/account] Error:', error);
    return NextResponse.json(
      { error: '계좌 등록에 실패했습니다' },
      { status: 500 },
    );
  }
}

/** 계좌 변경. refSellerId는 못 바꾸므로 셀러 수정 API로 계좌만 교체한다. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { data: existing } = await supabaseAdmin
      .from('payout_accounts')
      .select('provider_seller_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existing?.provider_seller_id) {
      return NextResponse.json(
        { error: '등록된 계좌가 없습니다' },
        { status: 404 },
      );
    }

    // 진행 중인 환전이 있으면 계좌를 바꾸지 못하게 한다.
    // 지급 도중에 목적지가 바뀌면 어디로 갔는지 추적이 어려워진다.
    const { data: open } = await supabaseAdmin
      .from('payouts')
      .select('id')
      .eq('user_id', user.id)
      .in('status', ['REQUESTED', 'IN_PROGRESS'])
      .limit(1);

    if (open && open.length > 0) {
      return NextResponse.json(
        { error: '진행 중인 환전이 끝난 뒤에 변경할 수 있습니다' },
        { status: 409 },
      );
    }

    const { account } = (await request.json()) ?? {};
    const bankCode = String(account?.bankCode ?? '').trim();
    const accountNumber = String(account?.accountNumber ?? '').replace(/\D/g, '');
    const holderName = String(account?.holderName ?? '').trim();

    if (!bankCode || !accountNumber || !holderName) {
      return NextResponse.json(
        { error: '은행, 계좌번호, 예금주를 모두 입력해주세요' },
        { status: 400 },
      );
    }

    const { tossPayoutApi } = await import('@/shared/lib/toss-payout');
    await tossPayoutApi.updateSeller(existing.provider_seller_id, {
      account: { bankCode, accountNumber, holderName },
    });

    const { error: updateError } = await supabaseAdmin
      .from('payout_accounts')
      .update({
        bank_code: bankCode,
        account_masked: maskAccount(accountNumber),
        holder_name: holderName,
      })
      .eq('user_id', user.id);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TossPayoutError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus >= 400 ? error.httpStatus : 502 },
      );
    }
    console.error('[Payout/account] PATCH error:', error);
    return NextResponse.json(
      { error: '계좌 변경에 실패했습니다' },
      { status: 500 },
    );
  }
}
