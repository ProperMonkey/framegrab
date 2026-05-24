import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true)
    .order('date_added', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { data, error } = await supabase
      .from('items')
      .insert({
        user_id: user.id,
        photo_url: body.photo_url,
        thumbnail_url: body.thumbnail_url ?? null,
        category: body.category,
        subcategory: body.subcategory ?? null,
        color_primary: body.color_primary ?? null,
        color_temp: body.color_temp ?? null,
        formality: body.formality ?? null,
        season: body.season ?? null,
        fabric: body.fabric ?? null,
        fit_notes: body.fit_notes ?? null,
        user_notes: body.user_notes ?? null,
        active: true,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('Item create error:', err);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
