import { ApiError, handleRoute, jsonResponse, parseId, readJsonBody } from '@/lib/api';
import { ADMIN_ROLES, requireRole, requireUser, WRITE_ROLES } from '@/lib/auth';
import { deleteProduct, getProductById, updateProduct } from '@/lib/repo/products';
import { getStockLogsForProduct } from '@/lib/repo/stock-logs';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { updateProductSchema } from '@/lib/validation';

/**
 * GET    /api/products/:id - ürün detayı ve son hareketleri
 * PATCH  /api/products/:id - ürünü güncelle
 * DELETE /api/products/:id - ürünü sil (yalnızca yönetici)
 *
 * Next.js 16'da dinamik parametreler promise olarak geliyor; `RouteContext`
 * yardımcısı yolu birebir yazarak tipleri üretiyor.
 */

export async function GET(_request: Request, context: RouteContext<'/api/products/[id]'>) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    await requireUser(supabase);

    const id = parseId((await context.params).id);

    const product = await getProductById(supabase, id);
    if (!product) {
      throw new ApiError(404, 'Ürün bulunamadı');
    }

    const logs = await getStockLogsForProduct(supabase, id);

    return jsonResponse({ product, logs });
  });
}

export async function PATCH(request: Request, context: RouteContext<'/api/products/[id]'>) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    await requireRole(supabase, WRITE_ROLES);

    const id = parseId((await context.params).id);
    const body = updateProductSchema.parse(await readJsonBody(request));

    const product = await updateProduct(supabase, id, {
      ...body,
      barcode: body.barcode === '' ? null : body.barcode,
    });

    if (!product) {
      throw new ApiError(404, 'Ürün bulunamadı');
    }

    return jsonResponse({ product });
  });
}

export async function DELETE(_request: Request, context: RouteContext<'/api/products/[id]'>) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    await requireRole(supabase, ADMIN_ROLES);

    const id = parseId((await context.params).id);

    const deleted = await deleteProduct(supabase, id);
    if (!deleted) {
      throw new ApiError(404, 'Ürün bulunamadı');
    }

    return jsonResponse({ deleted: true });
  });
}
