'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { OutfitSuggestion } from '@/types';

const VIBES = ['Casual', 'Smart casual', 'Sharp', 'Relaxed', 'Minimalist'];

export default function SuggestPage() {
  const [occasion, setOccasion] = useState('');
  const [weather, setWeather] = useState('');
  const [vibe, setVibe] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<OutfitSuggestion[] | null>(null);
  const [error, setError] = useState('');

  async function handleSuggest() {
    if (!occasion.trim() || !weather.trim()) return;
    setLoading(true);
    setError('');
    setSuggestions(null);

    try {
      const res = await fetch('/api/outfit/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occasion, weather, vibe: vibe || 'no preference' }),
      });
      if (!res.ok) throw new Error('Suggestion failed');
      const data = await res.json();
      setSuggestions(data);
    } catch {
      setError('Could not generate suggestions. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-12 pb-6">
      <h1 className="text-2xl font-bold mb-1">What Do I Wear?</h1>
      <p className="text-sm text-stone-500 mb-6">Get outfit options built from what you own.</p>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1.5">Occasion</label>
          <input
            className="input"
            placeholder="e.g. first date, office, weekend hike"
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1.5">Weather / temperature</label>
          <input
            className="input"
            placeholder="e.g. warm and sunny, cold, rainy 10°C"
            value={weather}
            onChange={(e) => setWeather(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-600 mb-2">Vibe (optional)</label>
          <div className="flex flex-wrap gap-2">
            {VIBES.map((v) => (
              <button
                key={v}
                onClick={() => setVibe(vibe === v ? '' : v)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  vibe === v ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 active:bg-stone-200'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleSuggest}
        disabled={!occasion.trim() || !weather.trim() || loading}
        className="btn-primary mb-8"
      >
        {loading ? 'Building outfits…' : 'Build me outfits'}
      </button>

      {error && <p className="mb-6 text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

      {suggestions && suggestions.length > 0 && (
        <div className="space-y-5">
          {suggestions.map((suggestion, index) => (
            <div key={index} className="card overflow-hidden">
              <div className="p-4 border-b border-stone-100 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-stone-400 mb-0.5">Option {index + 1}</p>
                  <h3 className="text-sm font-semibold text-stone-900">{suggestion.name}</h3>
                </div>
                <div className="text-right">
                  <p className="text-xs text-stone-400">Match</p>
                  <p className="text-lg font-bold text-stone-900">{suggestion.score}<span className="text-xs text-stone-400">/10</span></p>
                </div>
              </div>

              {/* Thumbnail grid */}
              {suggestion.items && suggestion.items.length > 0 && (
                <div className="flex gap-1 p-3">
                  {suggestion.items.map((item) => (
                    <div key={item.id} className="relative flex-1 aspect-square rounded-lg overflow-hidden bg-stone-100">
                      <Image
                        src={item.thumbnail_url ?? item.photo_url}
                        alt={item.subcategory ?? item.category}
                        fill
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="px-4 pb-4">
                <p className="text-sm text-stone-700 leading-relaxed">{suggestion.rationale}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {suggestions && suggestions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-stone-500 text-sm">No outfits could be built. Add more items to your closet and try again.</p>
        </div>
      )}
    </div>
  );
}
