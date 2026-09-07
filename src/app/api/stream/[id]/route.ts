import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { getFollowingSet } from '@/domains/user/services/follows';

// Get individual stream details
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const { data: stream, error } = await supabaseAdmin
      .from('streams')
      .select('id, title, description, category, tags, status, viewer_count, thumbnail_url, started_at, ended_at, user_id, stream_key, users!inner(id, nickname, avatar_url)')
      .eq('id', id)
      .single();

    if (error || !stream) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
    }

    // Never expose stream_key to clients
    const { stream_key: _, ...safeStream } = stream;

    const { following, viewerId } = await getFollowingSet([stream.user_id]);

    return NextResponse.json({
      data: {
        ...safeStream,
        is_following: following.has(stream.user_id),
        is_me: viewerId === stream.user_id,
      },
      error: null,
    });
  } catch (err) {
    console.error('[Stream] get error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
