import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { whepUrlFor, hlsUrlFor } from '@/shared/lib/media-url';

// 재생 URL 반환. 경로 이름이 stream id이므로 stream_key를 조회할 필요가 없다.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const { data: stream } = await supabaseAdmin
      .from('streams')
      .select('id, status')
      .eq('id', id)
      .single();

    if (!stream) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
    }

    if (stream.status !== 'live') {
      return NextResponse.json({ error: 'Stream is not live' }, { status: 404 });
    }

    return NextResponse.json({
      data: { whep_url: whepUrlFor(stream.id), hls_url: hlsUrlFor(stream.id) },
      error: null,
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
