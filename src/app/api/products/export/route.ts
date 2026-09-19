import type { NextRequest } from 'next/server';
import { handleRoute } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { formatPrice } from '@/lib/format';
import { getAllProducts } from '@/lib/repo/products';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * GET /api/products/export - ürün listesini CSV olarak indirir.
 *
 * Kolon başlıkları içe aktarmanın tanıdığı Türkçe adlarla yazılıyor: dışa
 * aktarılan dosya düzenlenip geri yüklenebilsin (mağazada en sık kullanılan
 * toplu güncelleme yöntemi bu).
 *
 * Fiyatlar Türkçe biçimde (virgüllü) yazılıyor; Excel'de sayı olarak açılıyor
 * ve içe aktarma tarafı virgüllü değeri zaten çözüyor.
 */

const HEADERS = [
  'Ürün Kodu',
  'Barkod',
  'Ürün Adı',
  'Kategori',
  'Reyon',
  'Alış Fiyatı',
  'Satış Fiyatı',
  'Stok',
  'Kritik Stok',
  'Birim',
  'Notlar',
];

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    await requireUser(supabase);

    const params = request.nextUrl.searchParams;
    const products = await getAllProducts(supabase, {
      search: params.get('search') ?? undefined,
      shelf: params.get('shelf') ?? undefined,
      category: params.get('category') ?? undefined,
      lowStock: params.get('lowStock') === 'true',
    });

    const rows = [
      HEADERS,
      ...products.map((product) => [
        product.code,
        product.barcode ?? '',
        product.name,
        product.category,
        product.shelf_location,
        formatPrice(product.cost_price),
        formatPrice(product.sale_price),
        String(product.stock_quantity),
        String(product.min_stock_alert),
        product.unit,
        product.notes,
      ]),
    ];

    const fileName = `reyonstok-urunler-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(toCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName}"`,
        // Dışa aktarma her zaman güncel veriyi vermeli.
        'cache-control': 'no-store',
      },
    });
  });
}
