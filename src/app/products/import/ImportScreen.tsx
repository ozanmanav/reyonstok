'use client';

import Link from 'next/link';
import { useState } from 'react';
import { parseCsv } from '@/lib/csv';
import { formatQuantity } from '@/lib/format';
import {
  type ColumnMapping,
  detectColumnMapping,
  FIELD_LABELS,
  type ImportedProduct,
  type ImportField,
  missingRequiredFields,
  parseImportRows,
  type RowError,
} from '@/lib/product-import';

/**
 * CSV içe aktarma akışı.
 *
 * Üç adım: dosya seç, kolon eşleştirmesini ve doğrulama raporunu gör, aktar.
 * Ortadaki adım bilinçli: mağaza dosyalarının kolon adları belli değil ve
 * yanlış eşleşmeyle 500 ürünün fiyatını bozmak geri alınamaz bir hata.
 *
 * Dosya tarayıcıda çözümleniyor; sunucuya yalnızca doğrulanmış satırlar
 * gidiyor. Böylece hatalı satırlar için ağ turu harcanmıyor ve rapor anında
 * görünüyor.
 */

interface Preview {
  fileName: string;
  /**
   * Dosyanın ham satırları (başlık dahil).
   *
   * Kolon eşleştirmesi elle değiştirilince doğrulamanın baştan çalışması
   * gerekiyor ama dosya artık elimizde olmuyor; bu yüzden satırlar burada
   * saklanıyor.
   */
  rows: string[][];
  mapping: ColumnMapping;
  products: ImportedProduct[];
  errors: RowError[];
}

interface ImportOutcome {
  inserted: number;
  updated: number;
  failures: { code: string; name: string; message: string }[];
}

const ALL_FIELDS = Object.keys(FIELD_LABELS) as ImportField[];

export default function ImportScreen() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setFileError(null);
    setOutcome(null);
    setPreview(null);

    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length === 0) {
        setFileError('Dosya boş görünüyor.');

        return;
      }

      if (rows.length === 1) {
        setFileError('Dosyada yalnızca başlık satırı var, ürün satırı bulunamadı.');

        return;
      }

      const mapping = detectColumnMapping(rows[0]);
      const { products, errors } = parseImportRows(rows, mapping);

      setPreview({ fileName: file.name, rows, mapping, products, errors });
    } catch {
      setFileError('Dosya okunamadı. UTF-8 kodlamalı bir CSV dosyası seçin.');
    }
  }

  /** Kolon eşleştirmesini elle değiştirir ve doğrulamayı yeniden çalıştırır. */
  function remap(field: ImportField, columnValue: string) {
    if (!preview) {
      return;
    }

    const mapping: ColumnMapping = { ...preview.mapping };

    if (columnValue === '') {
      delete mapping[field];
    } else {
      mapping[field] = Number(columnValue);
    }

    // Satırlar önizlemede saklandığı için dosyayı yeniden okumaya gerek yok.
    const { products, errors } = parseImportRows(preview.rows, mapping);

    setPreview({ ...preview, mapping, products, errors });
  }

  async function handleImport() {
    if (!preview || preview.products.length === 0) {
      return;
    }

    setPending(true);
    setFileError(null);

    try {
      const response = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ products: preview.products }),
      });

      const payload = (await response.json()) as ImportOutcome & {
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'İçe aktarma yapılamadı');
      }

      setOutcome(payload);
      setPreview(null);
    } catch (caught) {
      setFileError(caught instanceof Error ? caught.message : 'İçe aktarma yapılamadı');
    } finally {
      setPending(false);
    }
  }

  const missing = preview ? missingRequiredFields(preview.mapping) : [];

  return (
    <div className="space-y-4">
      {fileError ? (
        <p
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold text-rose-800"
        >
          {fileError}
        </p>
      ) : null}

      {outcome ? (
        <div className="space-y-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="text-sm font-black text-emerald-900">İçe aktarma tamamlandı</h2>
          <ul className="space-y-1 text-sm text-emerald-900">
            <li>{formatQuantity(outcome.inserted)} ürün eklendi</li>
            <li>{formatQuantity(outcome.updated)} ürün güncellendi</li>
            {outcome.failures.length > 0 ? (
              <li className="font-bold text-rose-800">
                {formatQuantity(outcome.failures.length)} satır kaydedilemedi
              </li>
            ) : null}
          </ul>

          {outcome.failures.length > 0 ? (
            <ul className="space-y-1 rounded-xl bg-white p-3 text-xs text-rose-800">
              {outcome.failures.map((failure) => (
                <li key={failure.code}>
                  <span className="font-mono font-bold">{failure.code}</span> {failure.name}:{' '}
                  {failure.message}
                </li>
              ))}
            </ul>
          ) : null}

          <Link
            href="/products"
            className="inline-block rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
          >
            Ürün listesine git
          </Link>
        </div>
      ) : null}

      {!preview && !outcome ? (
        <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-black text-zinc-900">CSV dosyası seçin</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              Excel&apos;den &quot;CSV olarak kaydet&quot; ile çıkardığınız dosyayı
              yükleyebilirsiniz. Noktalı virgül veya virgül ayırıcı, Türkçe karakterler ve virgüllü
              fiyatlar desteklenir.
            </p>
          </div>

          <label
            htmlFor="csv-file"
            className="inline-block cursor-pointer rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
          >
            Dosya seç
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFile(event)}
              className="sr-only"
            />
          </label>

          <div className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-600">
            <p className="font-bold text-zinc-800">Zorunlu kolonlar</p>
            <p className="mt-0.5">Ürün adı, reyon veya raf, satış fiyatı.</p>
            <p className="mt-2 font-bold text-zinc-800">İpucu</p>
            <p className="mt-0.5">
              Mevcut ürünleri güncellemek için önce{' '}
              <Link href="/api/products/export" className="underline">
                CSV indir
              </Link>{' '}
              ile listeyi alıp üzerinde değişiklik yapın; ürün kodu eşleşen satırlar güncellenir.
            </p>
          </div>
        </div>
      ) : null}

      {preview ? (
        <>
          <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black text-zinc-900">Kolon eşleştirmesi</h2>
              <span className="truncate text-xs text-zinc-500">{preview.fileName}</span>
            </div>

            <p className="text-xs leading-relaxed text-zinc-600">
              Kolonlar başlık adlarına göre otomatik eşleştirildi. Yanlış eşleşme varsa düzeltin.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {ALL_FIELDS.map((field) => (
                <div key={field} className="flex items-center gap-2">
                  <label
                    htmlFor={`map-${field}`}
                    className="w-32 shrink-0 text-xs font-semibold text-zinc-700"
                  >
                    {FIELD_LABELS[field]}
                  </label>
                  <select
                    id={`map-${field}`}
                    value={preview.mapping[field] ?? ''}
                    onChange={(event) => remap(field, event.target.value)}
                    className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
                  >
                    <option value="">Eşleştirilmedi</option>
                    {preview.rows[0].map((header, index) => (
                      /*
                        Kolonun kimliği zaten konumu: `value={index}` eşleştirmede
                        kullanılan değerin kendisi. Liste sıralanmıyor,
                        filtrelenmiyor, araya ekleme yapılmıyor; dosya
                        değiştiğinde önizlemenin tamamı baştan kuruluyor. Başlık
                        adı tek başına anahtar olamaz, CSV'de aynı başlık iki
                        kolonda geçebiliyor.
                      */
                      // biome-ignore lint/suspicious/noArrayIndexKey: kolonun kimliği konumudur, liste hiç yeniden sıralanmıyor (bkz. üstteki not)
                      <option key={`${header}-${index}`} value={index}>
                        {header || `Kolon ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {missing.length > 0 ? (
              <p
                role="alert"
                className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-800"
              >
                Zorunlu kolonlar eşleştirilmedi: {missing.map((f) => FIELD_LABELS[f]).join(', ')}
              </p>
            ) : null}
          </div>

          <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-zinc-900">Doğrulama raporu</h2>

            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Toplam satır" value={preview.rows.length - 1} />
              <Stat label="Aktarılacak" value={preview.products.length} tone="good" />
              <Stat label="Hatalı" value={preview.errors.length} tone="bad" />
            </div>

            {preview.errors.length > 0 ? (
              <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl bg-rose-50 p-3">
                {preview.errors.map((error) => (
                  <p key={error.line} className="text-xs text-rose-800">
                    <span className="font-bold">{error.line}. satır:</span>{' '}
                    {error.messages.join('; ')}
                  </p>
                ))}
              </div>
            ) : null}

            {preview.products.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="py-1 pr-3 font-semibold">Kod</th>
                      <th className="py-1 pr-3 font-semibold">Ürün</th>
                      <th className="py-1 pr-3 font-semibold">Reyon</th>
                      <th className="py-1 pr-3 font-semibold">Fiyat</th>
                      <th className="py-1 font-semibold">Stok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.products.slice(0, 5).map((product, index) => (
                      /*
                        Salt okunur önizleme tablosu. Satırlar sıralanmıyor,
                        silinmiyor, araya eklenmiyor; dosya değiştiğinde liste
                        baştan kuruluyor. Kod tek başına anahtar olamaz: içe
                        aktarılan satırların kodu boş olabiliyor (sunucu atıyor)
                        ve ad yinelenebiliyor.
                      */
                      <tr
                        // biome-ignore lint/suspicious/noArrayIndexKey: salt okunur önizleme, satırlar hiç yeniden sıralanmıyor (bkz. üstteki not)
                        key={`${product.code ?? product.name}-${index}`}
                        className="border-t border-zinc-100"
                      >
                        <td className="py-1.5 pr-3 font-mono">{product.code ?? 'otomatik'}</td>
                        <td className="py-1.5 pr-3">{product.name}</td>
                        <td className="py-1.5 pr-3">{product.shelf_location}</td>
                        <td className="py-1.5 pr-3">{product.sale_price}</td>
                        <td className="py-1.5">{product.stock_quantity ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.products.length > 5 ? (
                  <p className="mt-1 text-xs text-zinc-500">İlk 5 satır gösteriliyor.</p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={pending || preview.products.length === 0 || missing.length > 0}
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {pending
                  ? 'Aktarılıyor...'
                  : `${formatQuantity(preview.products.length)} ürünü aktar`}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={pending}
                className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700"
              >
                Vazgeç
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  const color =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'bad' && value > 0
        ? 'text-rose-700'
        : 'text-zinc-900';

  return (
    <div className="rounded-xl bg-zinc-50 px-2 py-2.5">
      <p className={`text-xl font-black ${color}`}>{formatQuantity(value)}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-zinc-500">{label}</p>
    </div>
  );
}
