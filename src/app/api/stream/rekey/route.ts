import { NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { randomUUID } from 'crypto';

// Regenerate stream key
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the user's stream
    const { data: stream } = await supabaseAdmin
      .from('streams')
      .select('id, status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!stream) {
      return NextResponse.json({ error: 'No stream found' }, { status: 404 });
    }

    if (stream.status === 'live') {
      return NextResponse.json({ error: 'Cannot rekey while live' }, { status: 409 });
    }

    const newKey = randomUUID();

    await supabaseAdmin
      .from('streams')
      .update({ stream_key: newKey })
      .eq('id', stream.id);

    return NextResponse.json({ data: { stream_key: newKey }, error: null });
  } catch (err) {
    console.error('[Stream] rekey error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
