export type Category = 'top' | 'bottom' | 'shoe' | 'outerwear' | 'accessory';
export type ColorTemp = 'warm' | 'cool' | 'neutral';
export type Formality = 'casual' | 'smart_casual' | 'business' | 'formal';
export type Season = 'all' | 'spring_fall' | 'winter' | 'summer';

export interface ClosetItem {
  id: string;
  user_id: string;
  photo_url: string;
  thumbnail_url: string | null;
  category: Category;
  subcategory: string | null;
  color_primary: string | null;
  color_temp: ColorTemp | null;
  formality: Formality | null;
  season: Season | null;
  fabric: string | null;
  fit_notes: string | null;
  user_notes: string | null;
  date_added: string;
  last_worn: string | null;
  active: boolean;
}

export interface AITags {
  category: Category;
  subcategory: string;
  color_primary: string;
  color_temp: ColorTemp;
  formality: Formality;
  season: Season;
  fabric: string;
  fit_notes: string;
}

export interface OutfitCritique {
  score: number;
  headline: string;
  critique: string;
  issues: string[];
  suggestions: string[];
}

export interface OutfitSuggestion {
  name: string;
  item_ids: string[];
  items: ClosetItem[];
  rationale: string;
  score: number;
}

export interface Outfit {
  id: string;
  user_id: string;
  item_ids: string[];
  occasion: string | null;
  ai_score: number | null;
  ai_critique: string | null;
  created_at: string;
  saved: boolean;
}
