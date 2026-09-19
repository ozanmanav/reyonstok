'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { isValidEan13 } from '@/lib/scan-code';
import type { Product } from '@/lib/types';

/**
 * Ürün ekleme ve düzenleme formu.
 *
 * Doğrulama iki yerde: burada anında geri bildirim için, sunucuda ise gerçek
 * kural olarak (zod şeması + veritabanı kısıtları). Buradaki kontroller yalnızca
 * personeli boş bir gidiş dönüşten kurtarıyor.
 *
 * Fiyat alanları virgüllü girişi kabul ediyor: Türkçe klavyede ondalık ayırıcı
 * virgül ve nokta beklemek kullanımı bozuyor.
 */

interface ProductFormProps {
  mode: 'create' | 'edit';
  /** Düzenlemede mevcut ürün, eklemede form için başlangıç değerleri. */
  initial: ProductFormValues;
  /** Düzenlenen ürünün kimliği (yalnızca edit modunda). */
  productId?: number;
}

export interface ProductFormValues {
  code: string;
  barcode: string;
  name: string;
  category: string;
  shelf_location: string;
  cost_price: string;
  sale_price: string;
  stock_quantity: string;
  min_stock_alert: string;
  unit: string;
  notes: string;
}

/** Virgüllü ondalık girişi sayıya çevirir. */
function parseDecimal(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

export default function ProductForm({ mode, initial, productId }: ProductFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formId = useId();

  function update<K extends keyof ProductFormValues>(field: K, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  /** Gönderim öncesi hızlı kontroller; asıl doğrulama sunucuda. */
  function validate(): string | null {
    if (values.name.trim() === '') {
      return 'Ürün adı zorunlu';
    }

    if (values.shelf_location.trim() === '') {
      return 'Reyon veya raf konumu zorunlu';
    }

    const salePrice = parseDecimal(values.sale_price);
    if (salePrice === null || salePrice < 0) {
      return 'Geçerli bir satış fiyatı girin';
    }

    const costPrice = parseDecimal(values.cost_price);
    if (values.cost_price.trim() !== '' && (costPrice === null || costPrice < 0)) {
      return 'Geçerli bir alış fiyatı girin';
    }

    const stock = parseDecimal(values.stock_quantity);
    if (
      values.stock_quantity.trim() !== '' &&
      (stock === null || !Number.isInteger(stock) || stock < 0)
    ) {
      return 'Stok adedi 0 veya daha büyük bir tam sayı olmalı';
    }

    const barcode = values.barcode.trim();
    // Tam 13 hane girildiyse kontrol hanesi tutmalı: yazım hatasını burada yakala.
    if (/^\d{13}$/.test(barcode) && !isValidEan13(barcode)) {
      return 'EAN-13 barkodunun kontrol hanesi hatalı, okunan değeri kontrol edin';
    }

    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const validationError = validate();
    if (validationError) {
      setError(validationError);

      return;
    }

    setError(null);
    setPending(true);

    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      category: values.category.trim() || undefined,
      shelf_location: values.shelf_location.trim(),
      sale_price: parseDecimal(values.sale_price),
      unit: values.unit.trim() || undefined,
      notes: values.notes.trim() || undefined,
      barcode: values.barcode.trim() === '' ? null : values.barcode.trim(),
    };

    if (values.code.trim() !== '') {
      payload.code = values.code.trim().toUpperCase();
    }

    if (values.cost_price.trim() !== '') {
      payload.cost_price = parseDecimal(values.cost_price);
    }

    if (values.stock_quantity.trim() !== '') {
      payload.stock_quantity = parseDecimal(values.stock_quantity);
    }

    if (values.min_stock_alert.trim() !== '') {
      payload.min_stock_alert = parseDecimal(values.min_stock_alert);
    }

    try {
      const response = await fetch(
        mode === 'create' ? '/api/products' : `/api/products/${productId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const data = (await response.json()) as {
        product?: Product;
        error?: { message?: string };
      };

      if (!response.ok || !data.product) {
        throw new Error(data.error?.message ?? 'Ürün kaydedilemedi');
      }

      // Kayıt sonrası ürünün tarama ekranına git: personel etiketi basmadan
      // önce bilgiyi doğrulayabilsin.
      router.push(`/scan?code=${encodeURIComponent(data.product.code)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ürün kaydedilemedi');
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? (
        <p
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold text-rose-800"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${formId}-name`}
          label="Ürün adı"
          value={values.name}
          onChange={(value) => update('name', value)}
          required
          className="sm:col-span-2"
        />

        <Field
          id={`${formId}-code`}
          label="Ürün kodu"
          value={values.code}
          onChange={(value) => update('code', value)}
          hint="Boş bırakırsanız sıradaki kod otomatik verilir."
          mono
        />

        <Field
          id={`${formId}-barcode`}
          label="Barkod"
          value={values.barcode}
          onChange={(value) => update('barcode', value)}
          hint="Ürünün üstündeki barkod. Yoksa boş bırakın."
          inputMode="numeric"
          mono
        />

        <Field
          id={`${formId}-shelf`}
          label="Reyon / raf"
          value={values.shelf_location}
          onChange={(value) => update('shelf_location', value)}
          required
        />

        <Field
          id={`${formId}-category`}
          label="Kategori"
          value={values.category}
          onChange={(value) => update('category', value)}
          hint="Boş bırakılırsa Genel olarak kaydedilir."
        />

        <Field
          id={`${formId}-sale-price`}
          label="Satış fiyatı (₺)"
          value={values.sale_price}
          onChange={(value) => update('sale_price', value)}
          required
          inputMode="decimal"
        />

        <Field
          id={`${formId}-cost-price`}
          label="Alış fiyatı (₺)"
          value={values.cost_price}
          onChange={(value) => update('cost_price', value)}
          inputMode="decimal"
        />

        <Field
          id={`${formId}-stock`}
          label="Stok adedi"
          value={values.stock_quantity}
          onChange={(value) => update('stock_quantity', value)}
          inputMode="numeric"
        />

        <Field
          id={`${formId}-min-stock`}
          label="Kritik stok eşiği"
          value={values.min_stock_alert}
          onChange={(value) => update('min_stock_alert', value)}
          hint="Stok bu değere düşünce uyarı gösterilir."
          inputMode="numeric"
        />

        <Field
          id={`${formId}-unit`}
          label="Birim"
          value={values.unit}
          onChange={(value) => update('unit', value)}
          hint="Adet, Kg, Kutu gibi."
        />

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor={`${formId}-notes`} className="block text-sm font-semibold text-zinc-700">
            Notlar
          </label>
          <textarea
            id={`${formId}-notes`}
            value={values.notes}
            onChange={(event) => update('notes', event.target.value)}
            rows={2}
            className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {pending
            ? 'Kaydediliyor...'
            : mode === 'create'
              ? 'Ürünü kaydet'
              : 'Değişiklikleri kaydet'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-bold text-zinc-700"
        >
          Vazgeç
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  required,
  inputMode,
  mono,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
  inputMode?: 'numeric' | 'decimal' | 'text';
  mono?: boolean;
  className?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className="block text-sm font-semibold text-zinc-700">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        aria-describedby={hintId}
        autoComplete="off"
        className={`w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 ${
          mono ? 'font-mono' : ''
        }`}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
