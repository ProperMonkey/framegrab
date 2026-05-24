import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { suggestOutfits } from '@/lib/anthropic';
import type { ClosetItem } from '@/types';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { occasion, weather, vibe } = await req.json();
    if (!occasion || !weather) {
      return NextResponse.json({ error: 'occasion and weather are required' }, { status: 400 });
    }

    const { data: wardrobe } = await supabase
      .from('items')
      .select('*')
      .eq('user_id', user.id)
      .eq('active', true);

    if (!wardrobe || wardrobe.length < 2) {
      return NextResponse.json({ error: 'Add at least 2 items to your closet first' }, { status: 400 });
    }

    const suggestions = await suggestOutfits(wardrobe, occasion, weather, vibe ?? 'no preference');

    // Hydrate item objects so the frontend can show thumbnails
    const wardrobeMap = new Map<string, ClosetItem>(wardrobe.map((i: ClosetItem) => [i.id, i]));
    const hydrated = suggestions.map((s) => ({
      ...s,
      items: (s.item_ids ?? []).map((id: string) => wardrobeMap.get(id)).filter(Boolean),
    }));

    return NextResponse.json(hydrated);
  } catch (err) {
    console.error('Outfit suggest error:', err);
    return NextResponse.json({ error: 'Suggestion failed' }, { status: 500 });
  }
}
