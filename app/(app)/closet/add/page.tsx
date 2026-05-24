'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type { AITags, Category, ColorTemp, Formality, Season } from '@/types';

const CATEGORIES: Category[] = ['top', 'bottom', 'shoe', 'outerwear', 'accessory'];
const COLOR_TEMPS: ColorTemp[] = ['warm', 'cool', 'neutral'];
const FORMALITIES: Formality[] = ['casual', 'smart_casual', 'business', 'formal'];
const SEASONS: Season[] = ['all', 'spring_fall', 'summer', 'winter'];

type Step = 'upload' | 'tagging' | 'confirm' | 'saving';

export default function AddItemPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [tags, setTags] = useState<Partial<AITags>>({});
  const [userNotes, setUserNotes] = useState('');
  const [error, setError] = useState('');

  function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Image must be under 20MB.');
      return;
    }

    setError('');
    setStep('tagging');

    try {
      const dataUrl = await readFileAsDataURL(file);
      setPreview(dataUrl);

      // Upload to Cloudinary
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { url, thumbnailUrl: thumb } = await uploadRes.json();
      setUploadedUrl(url);
      setThumbnailUrl(thumb);

      // Tag with Claude
      const tagRes = await fetch('/api/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      });
      if (!tagRes.ok) throw new Error('Tagging failed');
      const aiTags = await tagRes.json();
      setTags(aiTags);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setStep('upload');
    }
  }

  async function handleSave() {
    setStep('saving');
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo_url: uploadedUrl,
          thumbnail_url: thumbnailUrl,
          ...tags,
          user_notes: userNotes,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      router.push('/closet');
      router.refresh();
    } catch {
      setError('Could not save item. Try again.');
      setStep('confirm');
    }
  }

  function updateTag<K extends keyof AITags>(key: K, value: AITags[K]) {
    setTags((prev) => ({ ...prev, [key]: value }));
  }

  if (step === 'upload') {
    return (
      <div className="max-w-lg mx-auto px-4 pt-12">
        <button onClick={() => router.back()} className="mb-6 flex items-center gap-2 text-stone-500 text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <h1 className="text-2xl font-bold mb-2">Add a piece</h1>
        <p className="text-sm text-stone-500 mb-8">Photograph it flat or on a hanger for best results.</p>

        <button
          onClick={() => fileRef.current?.click()}
          className="w-full aspect-[4/3] rounded-2xl border-2 border-dashed border-stone-300 flex flex-col items-center justify-center gap-3 active:border-stone-500 transition-colors"
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm text-stone-500 font-medium">Tap to take or choose a photo</span>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        {error && <p className="mt-4 text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}
      </div>
    );
  }

  if (step === 'tagging') {
    return (
      <div className="max-w-lg mx-auto px-4 pt-12 flex flex-col items-center">
        {preview && (
          <div className="relative w-48 h-48 rounded-2xl overflow-hidden mb-8">
            <Image src={preview} alt="Garment" fill className="object-cover" />
            <div className="absolute inset-0 bg-stone-900/30 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        )}
        <h2 className="text-xl font-bold text-stone-900 mb-2">Analysing…</h2>
        <p className="text-sm text-stone-500 text-center">Claude is reading your garment — category, colour, formality, fabric.</p>
      </div>
    );
  }

  if (step === 'confirm' || step === 'saving') {
    return (
      <div className="max-w-lg mx-auto px-4 pt-12 pb-8">
        <button onClick={() => setStep('upload')} className="mb-6 flex items-center gap-2 text-stone-500 text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Retake
        </button>
        <h1 className="text-2xl font-bold mb-6">Confirm tags</h1>

        {preview && (
          <div className="relative w-full aspect-square rounded-2xl overflow-hidden mb-6">
            <Image src={preview} alt="Garment" fill className="object-cover" />
          </div>
        )}

        <div className="space-y-5">
          <Field label="Category">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Chip key={c} active={tags.category === c} onClick={() => updateTag('category', c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Subcategory">
            <input
              className="input"
              value={tags.subcategory ?? ''}
              onChange={(e) => updateTag('subcategory', e.target.value as AITags['subcategory'])}
              placeholder="e.g. chino, tee, sneaker"
            />
          </Field>

          <Field label="Primary colour">
            <input
              className="input"
              value={tags.color_primary ?? ''}
              onChange={(e) => updateTag('color_primary', e.target.value as AITags['color_primary'])}
              placeholder="e.g. olive green"
            />
          </Field>

          <Field label="Colour temperature">
            <div className="flex gap-2">
              {COLOR_TEMPS.map((t) => (
                <Chip key={t} active={tags.color_temp === t} onClick={() => updateTag('color_temp', t)}>{t}</Chip>
              ))}
            </div>
          </Field>

          <Field label="Formality">
            <div className="flex flex-wrap gap-2">
              {FORMALITIES.map((f) => (
                <Chip key={f} active={tags.formality === f} onClick={() => updateTag('formality', f)}>
                  {f.replace('_', ' ')}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Season">
            <div className="flex flex-wrap gap-2">
              {SEASONS.map((s) => (
                <Chip key={s} active={tags.season === s} onClick={() => updateTag('season', s)}>
                  {s.replace('_', ' ')}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Fabric">
            <input
              className="input"
              value={tags.fabric ?? ''}
              onChange={(e) => updateTag('fabric', e.target.value as AITags['fabric'])}
              placeholder="e.g. cotton, wool, denim"
            />
          </Field>

          <Field label="Notes (optional)">
            <textarea
              className="input resize-none"
              rows={2}
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="runs large, needs hemming, only for events…"
            />
          </Field>
        </div>

        {error && <p className="mt-4 text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

        <button
          onClick={handleSave}
          disabled={step === 'saving' || !tags.category}
          className="btn-primary mt-8"
        >
          {step === 'saving' ? 'Saving…' : 'Save to closet'}
        </button>
      </div>
    );
  }
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
