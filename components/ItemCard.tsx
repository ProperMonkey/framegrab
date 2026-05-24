import Image from 'next/image';
import Link from 'next/link';
import type { ClosetItem } from '@/types';

const formalityColors: Record<string, string> = {
  casual: 'bg-sky-100 text-sky-700',
  smart_casual: 'bg-violet-100 text-violet-700',
  business: 'bg-amber-100 text-amber-700',
  formal: 'bg-stone-100 text-stone-700',
};

interface Props {
  item: ClosetItem;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export default function ItemCard({ item, selectable, selected, onSelect }: Props) {
  const label = item.subcategory ?? item.category;
  const formalityClass = formalityColors[item.formality ?? 'casual'] ?? 'bg-stone-100 text-stone-700';

  const content = (
    <div className={`card overflow-hidden transition-all ${selectable ? 'cursor-pointer select-none' : ''} ${selected ? 'ring-2 ring-stone-900' : ''}`}>
      <div className="relative aspect-square bg-stone-100">
        <Image
          src={item.thumbnail_url ?? item.photo_url}
          alt={label}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 50vw, 200px"
        />
        {selected && (
          <div className="absolute inset-0 bg-stone-900/20 flex items-center justify-center">
            <div className="w-7 h-7 rounded-full bg-stone-900 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-xs font-medium text-stone-900 capitalize truncate">{label}</p>
        <p className="text-[10px] text-stone-500 truncate">{item.color_primary ?? '—'}</p>
        {item.formality && (
          <span className={`tag-chip mt-1.5 ${formalityClass}`}>
            {item.formality.replace('_', ' ')}
          </span>
        )}
      </div>
    </div>
  );

  if (selectable && onSelect) {
    return <button onClick={() => onSelect(item.id)} className="text-left w-full">{content}</button>;
  }

  return <Link href={`/closet/${item.id}`}>{content}</Link>;
}
