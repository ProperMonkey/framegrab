import Anthropic from '@anthropic-ai/sdk';
import type { AITags, ClosetItem, OutfitCritique, OutfitSuggestion } from '@/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function itemSummary(item: ClosetItem): string {
  return `- ${item.category} / ${item.subcategory ?? 'unknown'}: ${item.color_primary ?? 'unknown color'} (${item.color_temp ?? ''}), ${item.formality ?? 'unknown formality'}, ${item.season ?? 'all'} season${item.user_notes ? `, notes: "${item.user_notes}"` : ''}`;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }> {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const data = Buffer.from(buffer).toString('base64');
  const ct = res.headers.get('content-type') ?? 'image/jpeg';
  const mediaType = (ct.startsWith('image/') ? ct.split(';')[0] : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  return { data, mediaType };
}

export async function tagGarment(imageUrl: string): Promise<AITags> {
  const { data, mediaType } = await fetchImageAsBase64(imageUrl);
  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data },
          },
          {
            type: 'text',
            text: `Analyze this garment photo and return ONLY a JSON object with these exact fields — no other text:
{
  "category": "top|bottom|shoe|outerwear|accessory",
  "subcategory": "specific type e.g. tee, chino, sneaker, blazer, cardigan",
  "color_primary": "descriptive color name e.g. 'slate blue', 'olive green'",
  "color_temp": "warm|cool|neutral",
  "formality": "casual|smart_casual|business|formal",
  "season": "all|spring_fall|winter|summer",
  "fabric": "best guess e.g. 'cotton', 'wool', 'denim', 'leather'",
  "fit_notes": "any fit observations visible in the photo, or empty string"
}`,
          },
        ],
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in tag response');
  return JSON.parse(jsonMatch[0]) as AITags;
}

export async function critiqueOutfit(
  items: ClosetItem[],
  wardrobe: ClosetItem[],
  occasion: string
): Promise<OutfitCritique> {
  const wardrobeContext = wardrobe.map(itemSummary).join('\n');
  const outfitContext = items.map(itemSummary).join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: `You are a senior personal stylist with 15 years of experience. You give honest, specific, actionable critique. You know this user's full wardrobe.`,
    messages: [
      {
        role: 'user',
        content: `Full wardrobe:
${wardrobeContext}

Proposed outfit for ${occasion}:
${outfitContext}

Critique this combination. Return ONLY a JSON object — no other text:
{
  "score": 7.5,
  "headline": "One-line verdict (max 12 words)",
  "critique": "2-3 sentence honest assessment of why it works or doesn't",
  "issues": ["specific issue 1", "specific issue 2"],
  "suggestions": ["e.g. swap the white tee for the olive one you own", "add the leather belt from your closet"]
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in critique response');
  return JSON.parse(jsonMatch[0]) as OutfitCritique;
}

export async function suggestOutfits(
  wardrobe: ClosetItem[],
  occasion: string,
  weather: string,
  vibe: string
): Promise<OutfitSuggestion[]> {
  const wardrobeContext = wardrobe.map((item) => `[${item.id}] ${itemSummary(item)}`).join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    system: `You are a senior personal stylist. Build outfits exclusively from the user's actual wardrobe. Reference items by their exact ID.`,
    messages: [
      {
        role: 'user',
        content: `Wardrobe (each item shown as [id] details):
${wardrobeContext}

Build 2-3 outfits ranked by appropriateness for:
- Occasion: ${occasion}
- Weather/temp: ${weather}
- Vibe: ${vibe}

Return ONLY a JSON array — no other text:
[
  {
    "name": "outfit name",
    "item_ids": ["uuid1", "uuid2", "uuid3"],
    "rationale": "one paragraph explaining why this works for the occasion",
    "score": 8.5
  }
]`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON in suggest response');
  return JSON.parse(jsonMatch[0]) as OutfitSuggestion[];
}

export async function analyzeGaps(wardrobe: ClosetItem[]): Promise<string> {
  const wardrobeContext = wardrobe.map(itemSummary).join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: `You are a senior personal stylist conducting a wardrobe audit. Be specific about what is missing and why it matters for outfit combinations.`,
    messages: [
      {
        role: 'user',
        content: `Full wardrobe (${wardrobe.length} items):
${wardrobeContext}

Provide a closet gaps analysis. Identify:
1. Formality imbalances
2. Missing versatile pieces
3. Color/palette gaps
4. The 1-3 items that would unlock the most new outfit combinations

Write as 3-4 paragraphs of direct, specific advice. No lists. No filler. Reference actual items they own when making suggestions.`,
      },
    ],
  });

  return message.content[0].type === 'text' ? message.content[0].text : '';
}
