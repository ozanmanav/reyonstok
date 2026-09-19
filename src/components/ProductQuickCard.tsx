'use client';

import { useId, useState } from 'react';
import { formatChange, formatCurrency, formatQuantity, formatTime } from '@/lib/format';
import type { StockLogWithContext } from '@/lib/repo/stock-logs';
import { playBeep, vibrate } from '@/lib/sound';
import type { Product } from '@/lib/types';

/**
 * Taranan ürünün kartı ve hızlı stok/fiyat düzeltmesi.
 *
 * Tasarım kararları:
 *
 *  - Güncellemeler iyimser uygulanıyor: personel "-1"e bastığında sayı anında
 *    düşüyor, sunucu yanıtı gelince kesinleşiyor, hata olursa eski değere
 *    dönüyor. Mağaza içi mobil bağlantıda her dokunuşta bekleme hissi
 *    kullanımı yavaşlatırdı.
 *  - Hesap sunucuda yapılıyor; buradaki iyimser değer yalnızca görsel. Gerçek
 *    sonuç her zaman sunucudan dönen satır.
 *  - Görüntüleyici rolünde düzeltme bölümü hiç render edilmiyor. Bu bir güvenlik
 *    önlemi değil (yetki sunucuda ve RLS'te uygulanıyor), yalnızca kullanılamayan
 *    butonları göstermemek için.
 */

interface ProductQuickCardProps {
  product: Product;
  logs: StockLogWithContext[];
  /** Stok ve fiyat güncelleyebilen roller: yönetici ve personel. */
  canWrite: boolean;
}

interface AdjustBody {
  stockDelta?: number;
  absoluteStock?: number;
  newSalePrice?: number;
  note?: string;
}

export default function ProductQuickCard({
  product: initialProduct,
  logs: initialLogs,
  canWrite,
}: ProductQuickCardProps) {
  const [product, setProduct] = useState(initialProduct);
  const [logs, setLogs] = useState(initialLogs);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countValue, setCountValue] = useState('');
  const [priceValue, setPriceValue] = useState('');

  const priceLabelId = useId();
  const stockLabelId = useId();

  /**
   * Sunucuya gitmeden önce kartta gösterilecek tahmini sonucu üretir.
   * Kritik stok işareti de yeniden hesaplanıyor, aksi halde uyarı rengi bir
   * adım geriden gelirdi.
   */
  function predict(current: Product, body: AdjustBody): Product {
    const stock =
      body.absoluteStock !== undefined
        ? Math.max(0, body.absoluteStock)
        : body.stockDelta !== undefined
          ? Math.max(0, current.stock_quantity + body.stockDelta)
          : current.stock_quantity;

    const price = body.newSalePrice ?? current.sale_price;

    return {
      ...current,
      stock_quantity: stock,
      sale_price: price,
      is_low_stock: stock <= current.min_stock_alert,
    };
  }

  async function adjust(body: AdjustBody) {
    const previous = product;

    setError(null);
    setPending(true);
    setProduct(predict(previous, body));

    try {
      const response = await fetch(`/api/products/${previous.id}/adjust`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as {
        product?: Product;
        logs?: StockLogWithContext[];
        error?: { message?: string };
      };

      if (!response.ok || !payload.product) {
        throw new Error(payload.error?.message ?? 'Güncelleme yapılamadı');
      }

      setProduct(payload.product);
      setLogs(payload.logs ?? []);
      playBeep('success');
      vibrate();
    } catch (caught) {
      // İyimser değeri geri al: ekranda yanlış stok kalması, hata mesajından
      // daha kötü bir sonuç.
      setProduct(previous);
      setError(caught instanceof Error ? caught.message : 'Güncelleme yapılamadı');
      playBeep('warning');
    } finally {
      setPending(false);
    }
  }

  function submitCount(event: React.FormEvent) {
    event.preventDefault();

    const parsed = Number(countValue.replace(',', '.'));
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError('Sayılan adet 0 veya daha büyük bir tam sayı olmalı');

      return;
    }

    setCountValue('');
    void adjust({ absoluteStock: parsed, note: 'Sayım' });
  }

  function submitPrice(event: React.FormEvent) {
    event.preventDefault();

    // Personel klavyede virgül kullanıyor; nokta ile ikisini de kabul ediyoruz.
    const parsed = Number(priceValue.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Geçerli bir fiyat girin');

      return;
    }

    if (Math.abs(parsed * 100 - Math.round(parsed * 100)) > 1e-9) {
      setError('Fiyat en fazla iki ondalık basamak içerebilir');

      return;
    }

    setPriceValue('');
    void adjust({ newSalePrice: parsed, note: 'Fiyat güncelleme' });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 bg-zinc-900 px-4 py-2 text-white">
          <span className="truncate text-xs font-bold">{product.shelf_location}</span>
          <span className="shrink-0 font-mono text-[11px] text-zinc-400">{product.code}</span>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <h2 className="text-lg font-black leading-tight text-zinc-900">{product.name}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {product.category}
              {product.barcode ? (
                <>
                  {' · '}
                  <span className="font-mono">{product.barcode}</span>
                </>
              ) : null}
            </p>
          </div>

          {/*
            Değerler görünür etiketlerine aria-labelledby ile bağlı: ekran
            okuyucu "Satış fiyatı 290,00 ₺" diye okuyor, yoksa sayı bağlamsız
            kalıyordu.
          */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p
                id={priceLabelId}
                className="text-xs font-bold uppercase tracking-wider text-zinc-500"
              >
                Satış fiyatı
              </p>
              <p
                aria-labelledby={priceLabelId}
                className="text-3xl font-black tracking-tight text-emerald-700"
              >
                {formatCurrency(product.sale_price)}
              </p>
            </div>

            <div className="text-right">
              <p
                id={stockLabelId}
                className="text-xs font-bold uppercase tracking-wider text-zinc-500"
              >
                Stok
              </p>
              <p
                aria-labelledby={stockLabelId}
                className={`text-3xl font-black tracking-tight ${
                  product.stock_quantity === 0
                    ? 'text-rose-600'
                    : product.is_low_stock
                      ? 'text-amber-600'
                      : 'text-zinc-900'
                }`}
              >
                {formatQuantity(product.stock_quantity)}{' '}
                <span className="text-sm font-bold text-zinc-500">{product.unit}</span>
              </p>
            </div>
          </div>

          {product.stock_quantity === 0 ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
              Bu ürün tükendi.
            </p>
          ) : product.is_low_stock ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              Stok kritik eşiğin altında (eşik: {formatQuantity(product.min_stock_alert)}).
            </p>
          ) : null}

          {product.notes ? (
            <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600">
              {product.notes}
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold text-rose-800"
        >
          {error}
        </p>
      ) : null}

      {canWrite ? (
        <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-black text-zinc-900">Hızlı düzeltme</h3>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending || product.stock_quantity === 0}
              onClick={() => void adjust({ stockDelta: -1, note: 'Tarama ile azaltma' })}
              className="rounded-2xl bg-zinc-900 py-4 text-xl font-black text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              −1
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void adjust({ stockDelta: 1, note: 'Tarama ile artırma' })}
              className="rounded-2xl bg-emerald-600 py-4 text-xl font-black text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              +1
            </button>
          </div>

          <form onSubmit={submitCount} className="space-y-1.5">
            <label htmlFor="counted-stock" className="block text-xs font-semibold text-zinc-700">
              Sayılan adet
            </label>
            <div className="flex gap-2">
              <input
                id="counted-stock"
                value={countValue}
                onChange={(event) => setCountValue(event.target.value)}
                inputMode="numeric"
                placeholder={String(product.stock_quantity)}
                className="min-w-0 flex-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
              />
              <button
                type="submit"
                disabled={pending || countValue.trim() === ''}
                className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white disabled:bg-zinc-300"
              >
                Kaydet
              </button>
            </div>
          </form>

          <form onSubmit={submitPrice} className="space-y-1.5">
            <label htmlFor="new-price" className="block text-xs font-semibold text-zinc-700">
              Yeni satış fiyatı
            </label>
            <div className="flex gap-2">
              <input
                id="new-price"
                value={priceValue}
                onChange={(event) => setPriceValue(event.target.value)}
                inputMode="decimal"
                placeholder={formatCurrency(product.sale_price)}
                className="min-w-0 flex-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
              />
              <button
                type="submit"
                disabled={pending || priceValue.trim() === ''}
                className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white disabled:bg-zinc-300"
              >
                Kaydet
              </button>
            </div>
          </form>
        </div>
      ) : (
        <p className="rounded-2xl bg-zinc-100 px-3.5 py-3 text-xs font-semibold text-zinc-600">
          Yetkiniz görüntüleme ile sınırlı; stok ve fiyat değiştirilemez.
        </p>
      )}

      <section aria-labelledby="son-hareketler" className="space-y-2">
        <h3 id="son-hareketler" className="text-sm font-black text-zinc-900">
          Bu ürünün son hareketleri
        </h3>

        {logs.length === 0 ? (
          <p className="rounded-2xl bg-white px-3.5 py-3 text-xs text-zinc-500 shadow-sm">
            Henüz hareket kaydı yok.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {logs.map((log) => (
              <li
                key={log.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs shadow-sm"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-800">{describeLog(log)}</p>
                  <p className="mt-0.5 text-zinc-500">
                    {formatTime(log.created_at)}
                    {' · '}
                    {/* RLS gereği başkasının profili okunamıyor; ad yoksa nötr ifade. */}
                    {log.user?.full_name?.trim() || 'Personel'}
                  </p>
                </div>

                {log.change_amount !== 0 ? (
                  <span
                    className={`shrink-0 font-black ${
                      log.change_amount > 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {formatChange(log.change_amount)}
                  </span>
                ) : (
                  <span className="shrink-0 font-bold text-emerald-700">
                    {log.new_price === null ? '' : formatCurrency(log.new_price)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Hareket kaydını tek satırlık Türkçe açıklamaya çevirir. */
function describeLog(log: StockLogWithContext): string {
  switch (log.type) {
    case 'initial_count':
      return 'İlk kayıt';
    case 'price_update':
      return 'Fiyat güncellendi';
    case 'import':
      return 'CSV içe aktarma';
    case 'scan_action':
      return 'Tarama';
    case 'stock_adjustment':
      return log.change_amount > 0
        ? `Stok artırıldı (${log.old_stock} → ${log.new_stock})`
        : `Stok azaltıldı (${log.old_stock} → ${log.new_stock})`;
    default:
      return 'Hareket';
  }
}
