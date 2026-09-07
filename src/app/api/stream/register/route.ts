import { NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { randomUUID } from 'crypto';

// Register as a streamer: upgrade role + create stream with stream_key
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if already a streamer
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role === 'streamer') {
      // Already a streamer, return existing stream
      const { data: stream } = await supabaseAdmin
        .from('streams')
        .select('id, stream_key, title, status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      return NextResponse.json({ data: { stream }, error: null });
    }

    const streamKey = randomUUID();

    // Upgrade role to streamer
    await supabaseAdmin
      .from('users')
      .update({ role: 'streamer' })
      .eq('id', user.id);

    // Create initial stream record
    const { data: stream, error } = await supabaseAdmin
      .from('streams')
      .insert({
        user_id: user.id,
        title: '내 라이브 방송',
        stream_key: streamKey,
        status: 'idle',
      })
      .select('id, stream_key, title, status')
      .single();

    if (error) {
      console.error('[Stream] register error:', error);
      return NextResponse.json({ error: 'Failed to create stream' }, { status: 500 });
    }

    return NextResponse.json({ data: { stream }, error: null });
  } catch (err) {
    console.error('[Stream] register error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
