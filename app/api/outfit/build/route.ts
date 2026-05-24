import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { critiqueOutfit } from '@/lib/anthropic';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { item_ids, occasion } = await req.json();
    if (!Array.isArray(item_ids) || item_ids.length < 2 || !occasion) {
      return NextResponse.json({ error: 'Need at least 2 items and an occasion' }, { status: 400 });
    }

    const { data: wardrobe } = await supabase
      .from('items')
      .select('*')
      .eq('user_id', user.id)
      .eq('active', true);

    const selected = (wardrobe ?? []).filter((i) => item_ids.includes(i.id));
    if (selected.length < 2) {
      return NextResponse.json({ error: 'Selected items not found' }, { status: 400 });
    }

    const critique = await critiqueOutfit(selected, wardrobe ?? [], occasion);
    return NextResponse.json(critique);
  } catch (err) {
    console.error('Outfit build error:', err);
    return NextResponse.json({ error: 'Critique failed' }, { status: 500 });
  }
}
