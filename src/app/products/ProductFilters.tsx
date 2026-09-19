'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';

/**
 * Ürün listesi filtreleri.
 *
 * Filtreler adres çubuğuna yazılıyor; sunucu tarafı listeyi oradan okuyor.
 * Böylece paylaşılabilir bağlantı, geri tuşu ve sayfa yenileme beklendiği gibi
 * çalışıyor.
 *
 * Arama alanı form gönderimiyle uygulanıyor (her tuşta istek atmıyor): mağaza
 * mobil bağlantısında her harfte sunucuya gitmek listeyi titretiyor.
 */
export default function ProductFilters({
  shelves,
  categories,
  initial,
  basePath = '/products',
}: {
  shelves: string[];
  categories: string[];
  initial: { search: string; shelf: string; category: string; lowStock: boolean };
  /**
   * Filtrelerin uygulanacağı sayfa. Etiket basım sayfası da aynı filtreleri
   * kullanıyor; oradan ürün listesine atlamamak için yol dışarıdan veriliyor.
   */
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fieldId = useId();

  const [search, setSearch] = useState(initial.search);

  /** Verilen değişiklikleri adres çubuğuna uygular. */
  function apply(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    router.push(query === '' ? basePath : `${basePath}?${query}`);
  }

  const hasAnyFilter =
    initial.search !== '' ||
    initial.shelf !== '' ||
    initial.category !== '' ||
    initial.lowStock;

  return (
    <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply({ search });
        }}
        className="space-y-1.5"
      >
        <label htmlFor={`${fieldId}-search`} className="block text-xs font-semibold text-zinc-700">
          Ara
        </label>
        <div className="flex gap-2">
          <input
            id={`${fieldId}-search`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ürün adı, kod, barkod veya reyon"
            className="min-w-0 flex-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
          />
          <button
            type="submit"
            className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white"
          >
            Ara
          </button>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor={`${fieldId}-shelf`}
            className="block text-xs font-semibold text-zinc-700"
          >
            Reyon
          </label>
          <select
            id={`${fieldId}-shelf`}
            value={initial.shelf}
            onChange={(event) => apply({ shelf: event.target.value })}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500"
          >
            <option value="">Tümü</option>
            {shelves.map((shelf) => (
              <option key={shelf} value={shelf}>
                {shelf}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={`${fieldId}-category`}
            className="block text-xs font-semibold text-zinc-700"
          >
            Kategori
          </label>
          <select
            id={`${fieldId}-category`}
            value={initial.category}
            onChange={(event) => apply({ category: event.target.value })}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500"
          >
            <option value="">Tümü</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <input
            type="checkbox"
            checked={initial.lowStock}
            onChange={(event) => apply({ lowStock: event.target.checked ? 'true' : null })}
            className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
          />
          Yalnızca kritik stok
        </label>

        {hasAnyFilter ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              router.push(basePath);
            }}
            className="text-xs font-bold text-zinc-500 underline"
          >
            Filtreleri temizle
          </button>
        ) : null}
      </div>
    </div>
  );
}
