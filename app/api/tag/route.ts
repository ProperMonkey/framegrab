import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { tagGarment } from '@/lib/anthropic';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) return NextResponse.json({ error: 'Missing imageUrl' }, { status: 400 });

    const tags = await tagGarment(imageUrl);
    return NextResponse.json(tags);
  } catch (err) {
    console.error('Tag error:', err);
    return NextResponse.json({ error: 'Tagging failed' }, { status: 500 });
  }
}
