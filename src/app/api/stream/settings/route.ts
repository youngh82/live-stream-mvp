import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import {
  isValidCategory,
  MAX_TAGS,
  MAX_TAG_LENGTH,
} from '@/domains/stream/categories';

// Update stream settings (title, description, category)
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, category, tags } = body;

    // Find the user's stream
    const { data: stream } = await supabaseAdmin
      .from('streams')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!stream) {
      return NextResponse.json({ error: 'No stream found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    if (title !== undefined) {
      const trimmed = String(title).trim();
      if (trimmed.length === 0 || trimmed.length > 100) {
        return NextResponse.json(
          { error: '방송 제목은 1~100자여야 합니다' },
          { status: 400 },
        );
      }
      updates.title = trimmed;
    }

    if (description !== undefined) {
      const value = String(description ?? '').trim();
      if (value.length > 500) {
        return NextResponse.json(
          { error: '방송 설명은 500자 이하여야 합니다' },
          { status: 400 },
        );
      }
      updates.description = value || null;
    }

    // 카테고리는 마스터 목록의 값만 받는다. 자유 텍스트를 허용하면
    // 오타로 분류가 갈라져서 탐색 칩도 취향 학습도 무의미해진다.
    if (category !== undefined) {
      if (category !== null && !isValidCategory(category)) {
        return NextResponse.json(
          { error: '알 수 없는 카테고리입니다' },
          { status: 400 },
        );
      }
      updates.category = category;
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return NextResponse.json(
          { error: '태그 형식이 올바르지 않습니다' },
          { status: 400 },
        );
      }
      const cleaned = [
        ...new Set(
          tags
            .map((t) => String(t).trim().replace(/^#/, ''))
            .filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH),
        ),
      ].slice(0, MAX_TAGS);
      updates.tags = cleaned;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('streams')
      .update(updates)
      .eq('id', stream.id)
      .select('id, title, description, category, tags, status')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    return NextResponse.json({ data: updated, error: null });
  } catch (err) {
    console.error('[Stream] settings error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
