'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import BarcodeScanner from '@/components/BarcodeScanner';
import ProductQuickCard from '@/components/ProductQuickCard';
import type { StockLogWithContext } from '@/lib/repo/stock-logs';
import { normalizeScan, type ScanResult } from '@/lib/scan-code';
import { playBeep } from '@/lib/sound';
import type { Product } from '@/lib/types';

/**
 * Tarama ekranının akışı.
 *
 * Kod okunduğunda kamera duraklatılıp ürün sorgulanıyor; sonuç gelene kadar
 * yükleniyor durumu gösteriliyor. Ürün bulunamazsa bu bir hata değil: personel
 * yeni ürün kaydına yönlendiriliyor ve okunan kod forma taşınıyor.
 *
 * Sorgu bilinçli olarak effect ile değil, okuma olayının içinden başlatılıyor.
 * Adresle (`?code=`) gelinen durumda ise sonuç sunucudan hazır geliyor, yani
 * ilk gösterim için istemciden ek istek atılmıyor.
 */

const SCAN_KIND_LABELS: Record<ScanResult['kind'], string> = {
  qr: 'Reyon karekodu',
  ean13: 'EAN-13 barkod',
  unknown: 'Tanınmayan biçim',
};

/** Sunucuda hazırlanan ilk sorgu sonucu. */
export type InitialLookup =
  | { status: 'found'; product: Product; logs: StockLogWithContext[] }
  | { status: 'missing' };

interface LookupState {
  status: 'loading' | 'found' | 'missing' | 'error';
  product?: Product;
  logs?: StockLogWithContext[];
  message?: string;
}

export default function ScanScreen({
  initialCode,
  initialLookup,
  canWrite,
}: {
  initialCode?: string;
  initialLookup?: InitialLookup;
  canWrite: boolean;
}) {
  const [scan, setScan] = useState<ScanResult | null>(() => {
    if (!initialCode) {
      return null;
    }

    const parsed = normalizeScan(initialCode);

    return parsed.code === '' ? null : parsed;
  });

  const [lookup, setLookup] = useState<LookupState | null>(() => initialLookup ?? null);

  // Hızlı okumalarda önceki isteğin geç gelen yanıtı yenisini ezmemeli.
  const requestIdRef = useRef(0);

  const lookupCode = useCallback(async (code: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLookup({ status: 'loading' });

    try {
      const response = await fetch(`/api/products/by-code?code=${encodeURIComponent(code)}`);
      const payload = (await response.json()) as {
        product?: Product | null;
        logs?: StockLogWithContext[];
        error?: { message?: string };
      };

      // Arada yeni bir okuma olduysa bu yanıtı yok say.
      if (requestIdRef.current !== requestId) {
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'Ürün sorgulanamadı');
      }

      if (!payload.product) {
        playBeep('warning');
        setLookup({ status: 'missing' });

        return;
      }

      setLookup({
        status: 'found',
        product: payload.product,
        logs: payload.logs ?? [],
      });
    } catch (caught) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      playBeep('warning');
      setLookup({
        status: 'error',
        message: caught instanceof Error ? caught.message : 'Ürün sorgulanamadı',
      });
    }
  }, []);

  /** Tarayıcıdan kod geldiğinde: kodu göster ve ürünü getir. */
  const handleScan = useCallback(
    (result: ScanResult) => {
      setScan(result);
      void lookupCode(result.code);
    },
    [lookupCode],
  );

  const reset = () => {
    // Bekleyen isteğin yanıtı yeni taramayı etkilemesin.
    requestIdRef.current += 1;
    setScan(null);
    setLookup(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">Karekod tara</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Reyon etiketindeki karekodu ya da ürünün üstündeki barkodu okutun.
        </p>
      </div>

      <BarcodeScanner onScan={handleScan} paused={scan !== null} />

      {scan ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                Okunan kod
              </p>
              <p className="mt-0.5 break-all font-mono text-sm font-black text-zinc-900">
                {scan.code}
              </p>
              <p className="text-[11px] text-zinc-500">{SCAN_KIND_LABELS[scan.kind]}</p>
            </div>

            <button
              type="button"
              onClick={reset}
              className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
            >
              Yeni tarama
            </button>
          </div>

          {lookup?.status === 'loading' ? (
            <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm font-semibold text-zinc-500 shadow-sm">
              Ürün bilgisi getiriliyor...
            </p>
          ) : null}

          {lookup?.status === 'found' && lookup.product ? (
            <ProductQuickCard
              // Ürün değiştiğinde kart iç durumunu sıfırlasın.
              key={lookup.product.id}
              product={lookup.product}
              logs={lookup.logs ?? []}
              canWrite={canWrite}
            />
          ) : null}

          {lookup?.status === 'missing' ? (
            <div className="space-y-3 rounded-3xl border border-amber-200 bg-amber-50 p-4">
              <div>
                <h2 className="text-sm font-black text-amber-900">Bu kodla kayıtlı ürün yok</h2>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Okunan kod sistemde bulunamadı. Ürünü şimdi kaydedebilirsiniz; kod yeni ürün
                  formuna taşınacak.
                </p>
              </div>

              {canWrite ? (
                <Link
                  href={newProductHref(scan)}
                  className="inline-block rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white"
                >
                  Yeni ürün olarak kaydet
                </Link>
              ) : (
                <p className="text-xs font-semibold text-amber-800">
                  Ürün ekleme yetkiniz yok, mağaza yöneticisine bildirin.
                </p>
              )}
            </div>
          ) : null}

          {lookup?.status === 'error' ? (
            <div className="space-y-2 rounded-3xl border border-rose-200 bg-rose-50 p-4">
              <p role="alert" className="text-sm font-semibold text-rose-800">
                {lookup.message}
              </p>
              <button
                type="button"
                onClick={() => void lookupCode(scan.code)}
                className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white"
              >
                Tekrar dene
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Yeni ürün formunun adresini üretir.
 *
 * Karekod okunduysa değer ürün kodu alanına, barkod okunduysa barkod alanına
 * gitmeli; personelin kodu elle kopyalaması gerekmesin.
 */
function newProductHref(scan: ScanResult): string {
  const params = new URLSearchParams();

  if (scan.kind === 'qr') {
    params.set('code', scan.code);
  } else {
    params.set('barcode', scan.code);
  }

  return `/products/new?${params.toString()}`;
}
