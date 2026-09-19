import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ProductForm, { type ProductFormValues } from '@/components/ProductForm';
import { ADMIN_ROLES, getCurrentUser, WRITE_ROLES } from '@/lib/auth';
import { getProductById } from '@/lib/repo/products';
import { buildScanUrl } from '@/lib/scan-code';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import DeleteProductButton from './DeleteProductButton';

export const metadata: Metadata = {
  title: 'Ürünü düzenle - ReyonStok',
};

/**
 * Ürün düzenleme.
 *
 * Silme yalnızca yöneticide: yanlışlıkla silinen ürünün hareket geçmişi de
 * gidiyor ve geri alınamıyor.
 */
export default async function EditProductPage({ params }: PageProps<'/products/[id]/edit'>) {
  const { id } = await params;
  const productId = Number(id);

  if (!Number.isInteger(productId) || productId <= 0) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const currentUser = await getCurrentUser(supabase);
  const product = await getProductById(supabase, productId);

  if (!product) {
    notFound();
  }

  const canWrite = currentUser ? WRITE_ROLES.includes(currentUser.profile.role) : false;
  const canDelete = currentUser ? ADMIN_ROLES.includes(currentUser.profile.role) : false;

  const initial: ProductFormValues = {
    code: product.code,
    barcode: product.barcode ?? '',
    name: product.name,
    category: product.category,
    shelf_location: product.shelf_location,
    // Formda Türkçe ondalık ayırıcı kullanılıyor.
    cost_price: String(product.cost_price).replace('.', ','),
    sale_price: String(product.sale_price).replace('.', ','),
    stock_quantity: String(product.stock_quantity),
    min_stock_alert: String(product.min_stock_alert),
    unit: product.unit,
    notes: product.notes,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black tracking-tight text-zinc-900">
            {product.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            <span className="font-mono">{product.code}</span>
            {' · '}
            {product.shelf_location}
          </p>
        </div>

        <Link
          href={buildScanUrl(product.code, '')}
          className="rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm font-bold text-zinc-700"
        >
          Tarama kartını aç
        </Link>
      </div>

      {canWrite ? (
        <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <ProductForm mode="edit" initial={initial} productId={product.id} />
        </div>
      ) : (
        <p className="rounded-2xl bg-zinc-100 px-3.5 py-3 text-sm font-semibold text-zinc-600">
          Yetkiniz görüntüleme ile sınırlı; ürün bilgileri değiştirilemez.
        </p>
      )}

      {canDelete ? (
        <div className="space-y-2 rounded-3xl border border-rose-200 bg-rose-50 p-4">
          <h2 className="text-sm font-black text-rose-900">Ürünü sil</h2>
          <p className="text-xs leading-relaxed text-rose-800">
            Silme geri alınamaz; ürünün stok ve fiyat hareket geçmişi de birlikte silinir.
          </p>
          <DeleteProductButton productId={product.id} productName={product.name} />
        </div>
      ) : null}
    </div>
  );
}
