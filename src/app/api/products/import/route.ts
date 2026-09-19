import { z } from 'zod';
import { ApiError, handleRoute, jsonResponse, readJsonBody } from '@/lib/api';
import { requireRole, WRITE_ROLES } from '@/lib/auth';
import { importProducts } from '@/lib/repo/import';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * POST /api/products/import - CSV ile çözümlenmiş ürünleri kaydeder.
 *
 * Dosya çözümleme ve doğrulama tarayıcıda yapılıyor; buraya yalnızca geçerli
 * satırlar geliyor. Yine de sunucu kendi doğrulamasını yapıyor: istemciye
 * güvenip doğrulanmamış veri yazmak, uç doğrudan çağrıldığında açık kapı olur.
 */

const MAX_ROWS = 5000;

const importedProductSchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  barcode: z.string().trim().max(64).nullable(),
  name: z.string().trim().min(1, 'Ürün adı zorunlu').max(200),
  category: z.string().trim().max(100).optional(),
  shelf_location: z.string().trim().min(1, 'Reyon veya raf zorunlu').max(120),
  cost_price: z.number().min(0).optional(),
  sale_price: z.number().min(0),
  stock_quantity: z.number().int().min(0).optional(),
  min_stock_alert: z.number().int().min(0).optional(),
  unit: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const importRequestSchema = z.object({
  products: z
    .array(importedProductSchema)
    .min(1, 'İçe aktarılacak ürün yok')
    .max(MAX_ROWS, `Tek seferde en fazla ${MAX_ROWS} satır aktarılabilir`),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    const user = await requireRole(supabase, WRITE_ROLES);

    const body = importRequestSchema.parse(await readJsonBody(request));

    // Aynı dosyada yinelenen kod, veritabanı hatasına dönüşmeden yakalanmalı.
    const codes = body.products
      .map((product) => product.code?.toUpperCase())
      .filter((code): code is string => Boolean(code));

    if (new Set(codes).size !== codes.length) {
      throw new ApiError(400, 'Gönderilen listede aynı ürün kodu birden fazla geçiyor');
    }

    const result = await importProducts(supabase, body.products, user.id);

    return jsonResponse(result);
  });
}
