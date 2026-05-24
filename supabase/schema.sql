-- Run this in your Supabase SQL editor to set up the schema

-- Items table
CREATE TABLE IF NOT EXISTS items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url     TEXT NOT NULL,
  thumbnail_url TEXT,
  category      TEXT NOT NULL CHECK (category IN ('top', 'bottom', 'shoe', 'outerwear', 'accessory')),
  subcategory   TEXT,
  color_primary TEXT,
  color_temp    TEXT CHECK (color_temp IN ('warm', 'cool', 'neutral')),
  formality     TEXT CHECK (formality IN ('casual', 'smart_casual', 'business', 'formal')),
  season        TEXT CHECK (season IN ('all', 'spring_fall', 'winter', 'summer')),
  fabric        TEXT,
  fit_notes     TEXT,
  user_notes    TEXT,
  date_added    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_worn     TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS items_user_id_idx ON items (user_id);
CREATE INDEX IF NOT EXISTS items_category_idx ON items (user_id, category, active);

-- Row Level Security
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own items"
  ON items FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own items"
  ON items FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own items"
  ON items FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own items"
  ON items FOR DELETE USING (auth.uid() = user_id);


-- Outfits table (for saving critiqued combos)
CREATE TABLE IF NOT EXISTS outfits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_ids    UUID[] NOT NULL,
  occasion    TEXT,
  ai_score    NUMERIC(3,1),
  ai_critique TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saved       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS outfits_user_id_idx ON outfits (user_id);

ALTER TABLE outfits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own outfits"
  ON outfits FOR ALL USING (auth.uid() = user_id);
