import type { NextRequest } from 'next/server';
import { ApiError, handleRoute, jsonResponse } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getProductByCode } from '@/lib/repo/products';
import { getStockLogsForProduct } from '@/lib/repo/stock-logs';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { normalizeScan } from '@/lib/scan-code';

/**
 * GET /api/products/by-code?code=... - taranan değerden ürünü bulur
 *
 * Gelen değer ham tarama çıktısı olabilir: ürün kodu, barkod veya reyon
 * etiketindeki `https://.../scan?code=...` adresi.
 *
 * Ürün bulunamadığında 404 yerine 200 ve `product: null` dönüyoruz; "bu kodla
 * ürün yok, yeni ürün oluştur" akışı bir hata değil, beklenen bir sonuç. Yanıtta
 * çözümlenmiş kod da yer alır, böylece yeni ürün formu doğru alana (karekod ise
 * ürün kodu, barkod ise barkod alanı) doldurulabilir.
 */
export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    await requireUser(supabase);

    const raw = request.nextUrl.searchParams.get('code');
    if (raw === null) {
      throw new ApiError(400, 'code parametresi zorunlu');
    }

    const scan = normalizeScan(raw);
    if (scan.code === '') {
      throw new ApiError(400, 'Okunan değerden kullanılabilir bir kod çıkarılamadı');
    }

    const product = await getProductByCode(supabase, raw);

    if (!product) {
      return jsonResponse({ product: null, scan });
    }

    const logs = await getStockLogsForProduct(supabase, product.id);

    return jsonResponse({ product, scan, logs });
  });
}
