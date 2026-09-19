'use client';

import { useMemo, useState } from 'react';
import ShelfTag from '@/components/ShelfTag';
import { formatQuantity } from '@/lib/format';
import { LABEL_FORMAT_LABELS, LABEL_FORMATS, type LabelFormat } from '@/lib/label';
import type { Product } from '@/lib/types';

/**
 * Etiket seçimi, biçim seçimi ve yazdırma.
 *
 * Karekodlar sunucuda üretilip hazır SVG olarak geliyor (`qrByCode`); bu bileşen
 * yalnızca hangi etiketin basılacağını ve düzeni yönetiyor. Böylece yazdırma
 * penceresi açıldığında beklenecek hiçbir iş kalmıyor.
 *
 * Seçim ekran durumu olarak tutuluyor, adres çubuğunda değil: yüz ürünün kodunu
 * adrese yazmak hem bağlantıyı kullanılamaz hale getirir hem her tıklamada
 * sunucuya gidip listeyi yeniden çizerdi.
 *
 * Seçilmeyen etiketler ekranda soluk kalıyor ama basılmıyor (`print:hidden`).
 * Ayrı bir "seçim listesi" + "önizleme" ikilisi telefonda iki kat yer kaplıyor ve
 * hangi satırın hangi etikete karşılık geldiğini takip etmeyi zorlaştırıyordu.
 */
export default function PrintLabelsScreen({
  products,
  qrByCode,
}: {
  products: Product[];
  /** Ürün kodundan, sunucuda üretilmiş karekod SVG'sine eşleme. */
  qrByCode: Record<string, string>;
}) {
  const [format, setFormat] = useState<LabelFormat>('a4');
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set());

  /**
   * Seçim, dışarıda bırakılanların kümesi olarak tutuluyor.
   *
   * Varsayılan davranış "filtredeki her şeyi bas" olduğu için, seçilenleri
   * saklamak listeyi ilk çizimde doldurmayı gerektirirdi; tersini saklamak
   * varsayılanı bedavaya getiriyor.
   */
  const selected = useMemo(
    () => products.filter((product) => !excluded.has(product.id)),
    [products, excluded]
  );

  const lastSelectedId = selected.at(-1)?.id;

  function toggle(productId: number) {
    setExcluded((current) => {
      const next = new Set(current);

      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }

      return next;
    });
  }

  const allSelected = excluded.size === 0;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm print:hidden">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="label-format" className="block text-xs font-semibold text-zinc-700">
              Etiket düzeni
            </label>
            <select
              id="label-format"
              value={format}
              onChange={(event) => setFormat(event.target.value as LabelFormat)}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500"
            >
              {LABEL_FORMATS.map((option) => (
                <option key={option} value={option}>
                  {LABEL_FORMAT_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() =>
                setExcluded(allSelected ? new Set(products.map((p) => p.id)) : new Set())
              }
              className="flex-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm font-bold text-zinc-700"
            >
              {allSelected ? 'Hiçbirini seçme' : 'Tümünü seç'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={selected.length === 0}
              className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              Yazdır
            </button>
          </div>
        </div>

        <p aria-live="polite" className="text-xs font-semibold text-zinc-600">
          {selected.length === 0
            ? 'Hiç etiket seçilmedi.'
            : `${formatQuantity(selected.length)} etiket basılacak.`}
          {format === 'a4'
            ? ' A4 sayfaya 3 sütun, sayfa başına 18 etiket yerleşir.'
            : ' Her etiket 58x40 mm ayrı sayfaya basılır.'}
        </p>

        <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-xs leading-relaxed text-zinc-600">
          Yazdırma penceresinde kenar boşluklarını ve ölçeklendirmeyi değiştirmeyin;
          karekodun boyutu etikette sabit tutuldu. Termal etiket yazıcısı
          kullanıyorsanız kağıt boyutunu yazdırma penceresinden seçin.
        </p>
      </div>

      {products.length === 0 ? (
        <p className="rounded-3xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 shadow-sm print:hidden">
          Bu filtrelere uyan ürün yok.
        </p>
      ) : (
        <div
          data-format={format}
          className="label-sheet grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {products.map((product) => {
            const isSelected = !excluded.has(product.id);

            return (
              <div
                key={product.id}
                className={[
                  'label-cell',
                  isSelected ? '' : 'opacity-40 print:hidden',
                  // Termal basımda her etiketten sonra sayfa atılıyor; sonuncuda
                  // atılırsa sonunda boş bir etiket harcanıyor.
                  product.id === lastSelectedId ? 'label-cell--last' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-zinc-600 print:hidden">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(product.id)}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="truncate">{isSelected ? 'Basılacak' : 'Atlanacak'}</span>
                  {/* Ekran okuyucuda onlarca "Basılacak" kutusu birbirinden
                      ayırt edilemiyor; ürün adı erişilebilir ada ekleniyor. */}
                  <span className="sr-only">: {product.name}</span>
                </label>

                <ShelfTag product={product} qrSvg={qrByCode[product.code] ?? ''} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
