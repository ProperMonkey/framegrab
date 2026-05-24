'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import type { ClosetItem, Category, ColorTemp, Formality, Season } from '@/types';

const CATEGORIES: Category[] = ['top', 'bottom', 'shoe', 'outerwear', 'accessory'];
const COLOR_TEMPS: ColorTemp[] = ['warm', 'cool', 'neutral'];
const FORMALITIES: Formality[] = ['casual', 'smart_casual', 'business', 'formal'];
const SEASONS: Season[] = ['all', 'spring_fall', 'summer', 'winter'];

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<ClosetItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [edited, setEdited] = useState<Partial<ClosetItem>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/items/${id}`)
      .then((r) => r.json())
      .then((data) => { setItem(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  function update<K extends keyof ClosetItem>(key: K, value: ClosetItem[K]) {
    setEdited((prev) => ({ ...prev, [key]: value }));
  }

  function get<K extends keyof ClosetItem>(key: K): ClosetItem[K] | undefined {
    return key in edited ? (edited as ClosetItem)[key] : item?.[key];
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edited),
      });
      if (!res.ok) throw new Error('Save failed');
      setItem((prev) => prev ? { ...prev, ...edited } : prev);
      setEdited({});
    } catch {
      setError('Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Remove this piece from your closet?')) return;
    setDeleting(true);
    try {
      await fetch(`/api/items/${id}`, { method: 'DELETE' });
      router.push('/closet');
      router.refresh();
    } catch {
      setError('Could not delete item.');
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-12">
        <div className="aspect-square bg-stone-100 rounded-2xl animate-pulse mb-6" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-stone-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-12 text-center">
        <p className="text-stone-500">Item not found.</p>
      </div>
    );
  }

  const hasChanges = Object.keys(edited).length > 0;

  return (
    <div className="max-w-lg mx-auto px-4 pt-12 pb-8">
      <button onClick={() => router.back()} className="mb-6 flex items-center gap-2 text-stone-500 text-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Closet
      </button>

      <div className="relative w-full aspect-square rounded-2xl overflow-hidden mb-6">
        <Image src={item.photo_url} alt={item.subcategory ?? item.category} fill className="object-cover" />
      </div>

      <div className="space-y-5">
        <Field label="Category">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <Chip key={c} active={get('category') === c} onClick={() => update('category', c)}>{c}</Chip>
            ))}
          </div>
        </Field>

        <Field label="Subcategory">
          <input className="input" value={get('subcategory') ?? ''} onChange={(e) => update('subcategory', e.target.value)} placeholder="e.g. chino, tee, sneaker" />
        </Field>

        <Field label="Primary colour">
          <input className="input" value={get('color_primary') ?? ''} onChange={(e) => update('color_primary', e.target.value)} placeholder="e.g. olive green" />
        </Field>

        <Field label="Colour temperature">
          <div className="flex gap-2">
            {COLOR_TEMPS.map((t) => (
              <Chip key={t} active={get('color_temp') === t} onClick={() => update('color_temp', t)}>{t}</Chip>
            ))}
          </div>
        </Field>

        <Field label="Formality">
          <div className="flex flex-wrap gap-2">
            {FORMALITIES.map((f) => (
              <Chip key={f} active={get('formality') === f} onClick={() => update('formality', f)}>{f.replace('_', ' ')}</Chip>
            ))}
          </div>
        </Field>

        <Field label="Season">
          <div className="flex flex-wrap gap-2">
            {SEASONS.map((s) => (
              <Chip key={s} active={get('season') === s} onClick={() => update('season', s)}>{s.replace('_', ' ')}</Chip>
            ))}
          </div>
        </Field>

        <Field label="Fabric">
          <input className="input" value={get('fabric') ?? ''} onChange={(e) => update('fabric', e.target.value)} placeholder="e.g. cotton, wool" />
        </Field>

        <Field label="Notes">
          <textarea className="input resize-none" rows={2} value={get('user_notes') ?? ''} onChange={(e) => update('user_notes', e.target.value)} placeholder="runs large, needs hemming…" />
        </Field>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

      <div className="mt-8 space-y-3">
        {hasChanges && (
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="w-full py-3.5 px-6 text-red-600 text-sm font-medium rounded-xl active:scale-[0.98] transition-transform disabled:opacity-40"
        >
          {deleting ? 'Removing…' : 'Remove from closet'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-600 mb-2">{label}</label>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors capitalize ${
        active ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 active:bg-stone-200'
      }`}
    >
      {children}
    </button>
  );
}
