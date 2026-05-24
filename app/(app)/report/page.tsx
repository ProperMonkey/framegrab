'use client';

import { useEffect, useState } from 'react';
import type { ClosetItem } from '@/types';

const MIN_ITEMS = 10;

export default function ReportPage() {
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/items')
      .then((r) => r.json())
      .then((data) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleAnalyse() {
    setAnalysing(true);
    setError('');
    try {
      const res = await fetch('/api/report');
      if (!res.ok) throw new Error('Analysis failed');
      const data = await res.json();
      setAnalysis(data.analysis);
    } catch {
      setError('Could not generate analysis. Try again.');
    } finally {
      setAnalysing(false);
    }
  }

  const byCategory = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {});

  const categoryLabels: Record<string, string> = {
    top: 'Tops',
    bottom: 'Bottoms',
    shoe: 'Shoes',
    outerwear: 'Outerwear',
    accessory: 'Accessories',
  };

  return (
    <div className="max-w-lg mx-auto px-4 pt-12 pb-6">
      <h1 className="text-2xl font-bold mb-1">Closet Report</h1>
      <p className="text-sm text-stone-500 mb-6">
        {items.length < MIN_ITEMS
          ? `Add ${MIN_ITEMS - items.length} more ${MIN_ITEMS - items.length === 1 ? 'piece' : 'pieces'} to unlock AI analysis.`
          : 'Full wardrobe breakdown and gap analysis.'}
      </p>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-stone-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            <div className="card p-4">
              <p className="text-3xl font-bold text-stone-900">{items.length}</p>
              <p className="text-xs text-stone-500 mt-0.5">Total pieces</p>
            </div>
            {Object.entries(byCategory).map(([cat, count]) => (
              <div key={cat} className="card p-4">
                <p className="text-3xl font-bold text-stone-900">{count}</p>
                <p className="text-xs text-stone-500 mt-0.5">{categoryLabels[cat] ?? cat}</p>
              </div>
            ))}
          </div>

          {/* Lock screen */}
          {items.length < MIN_ITEMS ? (
            <div className="card p-6 text-center">
              <div className="text-3xl mb-3">🔒</div>
              <h2 className="text-base font-semibold text-stone-900 mb-2">Gap analysis locked</h2>
              <p className="text-sm text-stone-500">
                You need {MIN_ITEMS} items to get meaningful wardrobe insights. You have {items.length}.
              </p>
              <div className="mt-4 bg-stone-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-stone-900 h-2 rounded-full transition-all"
                  style={{ width: `${(items.length / MIN_ITEMS) * 100}%` }}
                />
              </div>
              <p className="text-xs text-stone-400 mt-2">{items.length}/{MIN_ITEMS}</p>
            </div>
          ) : (
            <div>
              {!analysis ? (
                <button onClick={handleAnalyse} disabled={analysing} className="btn-primary mb-6">
                  {analysing ? 'Analysing wardrobe…' : 'Run gap analysis'}
                </button>
              ) : null}

              {error && <p className="mb-4 text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

              {analysis && (
                <div className="card p-5">
                  <h2 className="text-sm font-semibold text-stone-900 mb-4">What you&apos;re missing</h2>
                  {analysis.split('\n\n').map((para, i) => (
                    <p key={i} className="text-sm text-stone-700 leading-relaxed mb-3 last:mb-0">{para}</p>
                  ))}
                  <button
                    onClick={handleAnalyse}
                    disabled={analysing}
                    className="mt-4 text-xs text-stone-500 underline underline-offset-2"
                  >
                    Regenerate
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
