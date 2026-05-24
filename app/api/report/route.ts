import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { analyzeGaps } from '@/lib/anthropic';

const MIN_ITEMS = 10;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: wardrobe } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true);

  if (!wardrobe || wardrobe.length < MIN_ITEMS) {
    return NextResponse.json(
      { error: `Need at least ${MIN_ITEMS} items for analysis` },
      { status: 400 }
    );
  }

  try {
    const analysis = await analyzeGaps(wardrobe);
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error('Report error:', err);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
