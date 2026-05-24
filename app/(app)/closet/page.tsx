'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ItemCard from '@/components/ItemCard';
import type { ClosetItem, Category } from '@/types';

const categories: { label: string; value: Category | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Tops', value: 'top' },
  { label: 'Bottoms', value: 'bottom' },
  { label: 'Shoes', value: 'shoe' },
  { label: 'Outerwear', value: 'outerwear' },
  { label: 'Accessories', value: 'accessory' },
];

export default function ClosetPage() {
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/items')
      .then((r) => r.json())
      .then((data) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? items : items.filter((i) => i.category === filter);

  return (
    <div className="max-w-lg mx-auto px-4 pt-12 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">My Closet</h1>
          <p className="text-sm text-stone-500">{items.length} {items.length === 1 ? 'piece' : 'pieces'}</p>
        </div>
        <Link
          href="/closet/add"
          className="flex items-center gap-1.5 bg-stone-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl active:scale-95 transition-transform"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add
        </Link>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setFilter(cat.value)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === cat.value
                ? 'bg-stone-900 text-white'
                : 'bg-stone-100 text-stone-600 active:bg-stone-200'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card overflow-hidden animate-pulse">
              <div className="aspect-square bg-stone-100" />
              <div className="p-2.5 space-y-1.5">
                <div className="h-3 bg-stone-100 rounded w-2/3" />
                <div className="h-2.5 bg-stone-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">👕</div>
          <h2 className="text-lg font-semibold text-stone-900 mb-2">
            {items.length === 0 ? 'Your closet is empty' : 'No items in this category'}
          </h2>
          <p className="text-sm text-stone-500 mb-6">
            {items.length === 0
              ? 'Photograph a garment to get started.'
              : 'Try a different filter.'}
          </p>
          {items.length === 0 && (
            <Link href="/closet/add" className="inline-flex items-center gap-2 btn-primary max-w-xs mx-auto">
              Add your first piece
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
