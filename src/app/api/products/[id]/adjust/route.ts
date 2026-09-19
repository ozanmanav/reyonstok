import { handleRoute, jsonResponse, parseId, readJsonBody } from '@/lib/api';
import { requireRole, WRITE_ROLES } from '@/lib/auth';
import { adjustStockAndPrice } from '@/lib/repo/products';
import { getStockLogsForProduct } from '@/lib/repo/stock-logs';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { adjustStockSchema } from '@/lib/validation';

/**
 * POST /api/products/:id/adjust - stok ve/veya fiyatı güncelle
 *
 * Tarama ekranındaki -1 / +1 / sayılan adet / fiyat güncelle işlemlerinin ucu.
 * Güncelleme veritabanı fonksiyonu içinde tek işlemde yapılır, bu yüzden aynı
 * ürünü aynı anda güncelleyen iki personelden birinin işlemi kaybolmaz.
 */
export async function POST(request: Request, context: RouteContext<'/api/products/[id]/adjust'>) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    await requireRole(supabase, WRITE_ROLES);

    const id = parseId((await context.params).id);
    const body = adjustStockSchema.parse(await readJsonBody(request));

    const product = await adjustStockAndPrice(supabase, {
      productId: id,
      stockDelta: body.stockDelta,
      absoluteStock: body.absoluteStock,
      newSalePrice: body.newSalePrice,
      note: body.note,
    });

    // Arayüz kartın altındaki hareket listesini aynı yanıtla tazeliyor.
    const logs = await getStockLogsForProduct(supabase, id);

    return jsonResponse({ product, logs });
  });
}
