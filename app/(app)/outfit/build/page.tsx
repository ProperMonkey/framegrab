'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import ItemCard from '@/components/ItemCard';
import type { ClosetItem, OutfitCritique } from '@/types';

export default function BuildOutfitPage() {
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [occasion, setOccasion] = useState('');
  const [loading, setLoading] = useState(true);
  const [critiquing, setCritiquing] = useState(false);
  const [critique, setCritique] = useState<OutfitCritique | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/items')
      .then((r) => r.json())
      .then((data) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 4) {
        next.add(id);
      }
      return next;
    });
    setCritique(null);
  }

  async function handleCritique() {
    if (selected.size < 2 || !occasion.trim()) return;
    setCritiquing(true);
    setError('');
    setCritique(null);

    try {
      const res = await fetch('/api/outfit/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: [...selected], occasion }),
      });
      if (!res.ok) throw new Error('Critique failed');
      const data = await res.json();
      setCritique(data);
    } catch {
      setError('Could not generate critique. Try again.');
    } finally {
      setCritiquing(false);
    }
  }

  const selectedItems = items.filter((i) => selected.has(i.id));

  return (
    <div className="max-w-lg mx-auto px-4 pt-12 pb-6">
      <h1 className="text-2xl font-bold mb-1">Build an Outfit</h1>
      <p className="text-sm text-stone-500 mb-6">Select 2–4 pieces, then get a critique.</p>

      {/* Selected strip */}
      {selectedItems.length > 0 && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 no-scrollbar">
          {selectedItems.map((item) => (
            <button
              key={item.id}
              onClick={() => toggleSelect(item.id)}
              className="flex-shrink-0 relative w-16 h-16 rounded-xl overflow-hidden"
            >
              <Image src={item.thumbnail_url ?? item.photo_url} alt={item.subcategory ?? item.category} fill className="object-cover" />
              <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-stone-900 rounded-full flex items-center justify-center">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Occasion */}
      <div className="mb-6">
        <label className="block text-xs font-medium text-stone-600 mb-1.5">Occasion</label>
        <input
          className="input"
          placeholder="e.g. casual dinner, job interview, weekend brunch"
          value={occasion}
          onChange={(e) => { setOccasion(e.target.value); setCritique(null); }}
        />
      </div>

      {/* Critique button */}
      <button
        onClick={handleCritique}
        disabled={selected.size < 2 || !occasion.trim() || critiquing}
        className="btn-primary mb-8"
      >
        {critiquing
          ? 'Critiquing…'
          : selected.size < 2
          ? `Select ${2 - selected.size} more piece${2 - selected.size === 1 ? '' : 's'}`
          : 'Critique this outfit'}
      </button>

      {/* Critique result */}
      {critique && (
        <div className="card p-5 mb-8 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-stone-500 mb-1">Score</p>
              <p className="text-3xl font-bold text-stone-900">{critique.score}<span className="text-lg text-stone-400">/10</span></p>
            </div>
            <div className="flex-1 text-right">
              <p className="text-sm font-semibold text-stone-900">{critique.headline}</p>
            </div>
          </div>
          <p className="text-sm text-stone-700 leading-relaxed">{critique.critique}</p>
          {critique.issues.length > 0 && (
            <div>
              <p className="text-xs font-medium text-stone-500 mb-2">Issues</p>
              <ul className="space-y-1">
                {critique.issues.map((issue, i) => (
                  <li key={i} className="text-sm text-red-700 flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0">⚠</span>{issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {critique.suggestions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-stone-500 mb-2">From your closet</p>
              <ul className="space-y-1">
                {critique.suggestions.map((s, i) => (
                  <li key={i} className="text-sm text-stone-700 flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0">→</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="mb-6 text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

      {/* Wardrobe grid */}
      <p className="text-xs font-medium text-stone-500 mb-3">
        {selected.size}/4 selected
      </p>
      {loading ? (
        <div className="grid grid-cols-3 gap-2">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="aspect-square bg-stone-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} selectable selected={selected.has(item.id)} onSelect={toggleSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
