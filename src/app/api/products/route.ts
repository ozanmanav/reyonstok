import type { NextRequest } from 'next/server';
import { handleRoute, jsonResponse, readJsonBody } from '@/lib/api';
import { requireRole, requireUser, WRITE_ROLES } from '@/lib/auth';
import {
  createProduct,
  getAllCategories,
  getAllProducts,
  getAllShelves,
  getInventoryStats,
  getNextProductCode,
} from '@/lib/repo/products';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createProductSchema } from '@/lib/validation';

/**
 * GET  /api/products - filtrelenebilir ürün listesi, özet ve filtre seçenekleri
 * POST /api/products - yeni ürün kaydı
 *
 * Not: Next.js 15'ten beri GET route handler'ları varsayılan olarak dinamik,
 * bu yüzden ayrıca `dynamic = 'force-dynamic'` gerekmiyor.
 */

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    await requireUser(supabase);

    const params = request.nextUrl.searchParams;
    const filters = {
      search: params.get('search') ?? undefined,
      shelf: params.get('shelf') ?? undefined,
      category: params.get('category') ?? undefined,
      lowStock: params.get('lowStock') === 'true',
      limit: params.has('limit') ? Number(params.get('limit')) : undefined,
    };

    // Liste ekranı bu dört veriyi birlikte kullanıyor; tek istekte dönmek
    // mobil bağlantıda dört ayrı gidiş dönüşten hızlı.
    const [products, stats, shelves, categories] = await Promise.all([
      getAllProducts(supabase, filters),
      getInventoryStats(supabase),
      getAllShelves(supabase),
      getAllCategories(supabase),
    ]);

    return jsonResponse({ products, stats, shelves, categories });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    const user = await requireRole(supabase, WRITE_ROLES);

    const body = createProductSchema.parse(await readJsonBody(request));

    const product = await createProduct(
      supabase,
      {
        ...body,
        // Boş dize gönderildiğinde barkod alanı temizlenmiş sayılır.
        barcode: body.barcode === '' ? null : body.barcode,
        code: body.code ?? (await getNextProductCode(supabase)),
      },
      user.id,
    );

    return jsonResponse({ product }, 201);
  });
}
