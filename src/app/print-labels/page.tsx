import type { Metadata } from 'next';
import PrintLabelsScreen from './PrintLabelsScreen';
import ProductFilters from '@/app/products/ProductFilters';
import {
  LABEL_BATCH_LIMIT,
  buildLabelPayload,
  siteUrlFromEnv,
  siteUrlWarning,
} from '@/lib/label';
import { renderQrSvgMap } from '@/lib/qr';
import {
  getAllCategories,
  getAllProducts,
  getAllShelves,
  type ProductFilters as Filters,
} from '@/lib/repo/products';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatQuantity } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Etiket bas - ReyonStok',
};

/**
 * Reyon etiketi basımı.
 *
 * Karekodlar burada, sunucuda üretiliyor: yazdırma penceresi açıldığında
 * bekleyecek hiçbir iş kalmamalı (bkz. src/lib/qr.ts).
 *
 * Etiket basımı okuma işlemi olduğu için görüntüleyici rolü de kullanabilir;
 * ayrı bir yetki kontrolü yok.
 *
 * Filtreler `/products` ile aynı bileşenden ve aynı adres parametrelerinden
 * geliyor: personel ürün listesinde daralttığı filtreyi buraya taşıyabiliyor.
 */
export default async function PrintLabelsPage({ searchParams }: PageProps<'/print-labels'>) {
  const params = await searchParams;

  const filters: Filters = {
    search: readParam(params.search),
    shelf: readParam(params.shelf),
    category: readParam(params.category),
    lowStock: readParam(params.lowStock) === 'true',
    // Sınırın bir fazlasını istiyoruz: taşma olup olmadığını ayrı bir sayım
    // sorgusu atmadan anlamak için.
    limit: LABEL_BATCH_LIMIT + 1,
  };

  const supabase = await createSupabaseServerClient();

  const [matched, shelves, categories] = await Promise.all([
    getAllProducts(supabase, filters),
    getAllShelves(supabase),
    getAllCategories(supabase),
  ]);

  const overflow = matched.length > LABEL_BATCH_LIMIT;
  const products = overflow ? matched.slice(0, LABEL_BATCH_LIMIT) : matched;

  const siteUrl = siteUrlFromEnv(process.env);
  const warning = siteUrlWarning(siteUrl);

  const payloadByCode = Object.fromEntries(
    products.map((product) => [product.code, buildLabelPayload(product.code, siteUrl)])
  );
  const svgByPayload = await renderQrSvgMap(Object.values(payloadByCode));

  const qrByCode = Object.fromEntries(
    Object.entries(payloadByCode).map(([code, payload]) => [code, svgByPayload[payload]])
  );

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">Etiket bas</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Reyona yapıştırılacak karekodlu fiyat etiketlerini hazırlayın. Etiketi okutan
          telefon doğrudan ürünün tarama sayfasını açar.
        </p>
      </div>

      {warning ? (
        <p
          role="alert"
          className="rounded-2xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm font-semibold leading-relaxed text-amber-900 print:hidden"
        >
          {warning}
        </p>
      ) : null}

      {overflow ? (
        <p
          role="status"
          className="rounded-2xl border border-zinc-300 bg-zinc-50 px-3.5 py-3 text-sm leading-relaxed text-zinc-700 print:hidden"
        >
          Filtreye {formatQuantity(matched.length)} ürün veya daha fazlası uyuyor; tek seferde
          en çok {formatQuantity(LABEL_BATCH_LIMIT)} etiket hazırlanıyor. Reyon filtresiyle
          daraltıp parça parça basın.
        </p>
      ) : null}

      <div className="print:hidden">
        <ProductFilters
          basePath="/print-labels"
          shelves={shelves}
          categories={categories}
          initial={{
            search: filters.search ?? '',
            shelf: filters.shelf ?? '',
            category: filters.category ?? '',
            lowStock: filters.lowStock ?? false,
          }}
        />
      </div>

      {/*
        Filtre değiştiğinde bileşen baştan kuruluyor: seçim durumu ürün
        kimliklerine dayandığı için, liste değişince eski seçim yanlış etiketlerin
        atlanmasına yol açardı.
      */}
      <PrintLabelsScreen
        key={filterKey(filters)}
        products={products}
        qrByCode={qrByCode}
      />
    </div>
  );
}

/** Adres parametresini tek bir metne indirir; dizi gelirse ilkini alır. */
function readParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value && value.trim() !== '' ? value : undefined;
}

function filterKey(filters: Filters): string {
  return [filters.search, filters.shelf, filters.category, filters.lowStock].join('|');
}
