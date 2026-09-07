import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import { DONATION_EVENTS_CHANNEL } from '@/domains/donation/types';
import { recordSignal } from '@/domains/feed/services/record-signal';
import { isBanned } from '@/domains/moderation/services/bans';

const MAX_AMOUNT = 1_000_000;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { streamId, amount, message } = await request.json();

    // M-03: 정수 여부와 상한을 입구에서 검증한다.
    // 이전에는 amount > 0만 봐서 1e9나 100.7도 통과했다.
    if (
      !streamId ||
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > MAX_AMOUNT
    ) {
      return NextResponse.json(
        { error: '후원 금액은 1 ~ 1,000,000 사이의 정수여야 합니다' },
        { status: 400 },
      );
    }

    if (message && message.length > 50) {
      return NextResponse.json(
        { error: '후원 메시지는 50자 이하여야 합니다' },
        { status: 400 },
      );
    }

    const { data: stream } = await supabaseAdmin
      .from('streams')
      .select('user_id, category')
      .eq('id', streamId)
      .eq('status', 'live')
      .single();

    if (!stream) {
      return NextResponse.json(
        { error: '라이브 방송을 찾을 수 없습니다' },
        { status: 404 },
      );
    }

    // ------------------------------------------------------------------
    // 채팅 제재는 여기에도 걸려야 한다.
    //
    // 후원 메시지는 HTTP로 들어와서 채팅에 표시된다. 소켓만 막으면
    // **차단된 유저가 후원 메시지로 계속 말을 걸 수 있다.**
    // 돈을 내야 하니 어렵다고 볼 수도 있지만, 괴롭힘의 수단으로는
    // 오히려 더 눈에 띄는 경로다.
    // ------------------------------------------------------------------
    const ban = await isBanned(
      redis,
      stream.user_id,
      user.id,
      async (channelId, userId) => {
        const { data } = await supabaseAdmin
          .from('channel_bans')
          .select('expires_at')
          .eq('channel_id', channelId)
          .eq('user_id', userId)
          .maybeSingle();
        return data ?? null;
      },
    );

    if (ban.banned) {
      return NextResponse.json(
        { error: '이 방송에서 차단되어 후원할 수 없습니다' },
        { status: 403 },
      );
    }

    if (stream.user_id === user.id) {
      return NextResponse.json(
        { error: '본인 방송에는 후원할 수 없습니다' },
        { status: 400 },
      );
    }

    const { data: donationId, error } = await supabaseAdmin.rpc(
      'send_donation',
      {
        p_stream_id: streamId,
        p_sender_id: user.id,
        p_receiver_id: stream.user_id,
        p_amount: amount,
        p_message: message || null,
      },
    );

    if (error) {
      if (error.message.includes('Insufficient balance')) {
        return NextResponse.json(
          { error: '포인트가 부족합니다' },
          { status: 400 },
        );
      }
      console.error('[Donation] Error:', error);
      return NextResponse.json(
        { error: '후원 처리에 실패했습니다' },
        { status: 500 },
      );
    }

    // 후원자 프로필 (알림 표시용)
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('point_balance, nickname, avatar_url')
      .eq('id', user.id)
      .single();

    // H-01: 알림을 서버가 발행한다.
    //
    // 이전에는 클라이언트가 socket.emit('donation:send', { amount })로
    // 직접 알림을 쐈기 때문에, 결제 없이 임의 금액의 후원 알림을 띄울 수 있었다.
    // 이제 DB 커밋이 성공한 뒤 서버만 이 채널에 발행하므로
    // 알림에 찍히는 금액은 실제로 차감된 금액과 항상 일치한다.
    await redis.publish(
      DONATION_EVENTS_CHANNEL,
      JSON.stringify({
        donationId,
        streamId,
        senderId: user.id,
        nickname: profile?.nickname ?? 'Unknown',
        avatarUrl: profile?.avatar_url ?? null,
        amount,
        message: message || null,
      }),
    );

    // 후원은 가장 강한 취향 신호다. 위조하면 남의 방송을 추천 상위로
    // 밀어 올릴 수 있으므로 클라이언트가 아니라 여기서만 기록한다.
    await recordSignal({
      userId: user.id,
      targetType: 'stream',
      targetId: streamId,
      kind: 'donation',
      category: stream.category,
    });

    return NextResponse.json({
      donationId,
      balance: profile?.point_balance ?? 0,
    });
  } catch (error) {
    console.error('[Donation] Error:', error);
    return NextResponse.json(
      { error: '후원 처리에 실패했습니다' },
      { status: 500 },
    );
  }
}
