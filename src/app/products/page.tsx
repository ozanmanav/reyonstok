import type { Metadata } from 'next';
import Link from 'next/link';
import ProductFilters from './ProductFilters';
import { getCurrentUser, WRITE_ROLES } from '@/lib/auth';
import { formatCurrency, formatQuantity } from '@/lib/format';
import {
  getAllCategories,
  getAllProducts,
  getAllShelves,
  type ProductFilters as Filters,
} from '@/lib/repo/products';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Ürünler - ReyonStok',
};

/**
 * Ürün listesi.
 *
 * Filtreler adres çubuğunda tutuluyor: personel bir reyonun listesini
 * telefonunda açıp bağlantıyı paylaşabiliyor, geri tuşu da beklendiği gibi
 * çalışıyor.
 */
export default async function ProductsPage({ searchParams }: PageProps<'/products'>) {
  const params = await searchParams;

  const filters: Filters = {
    search: readParam(params.search),
    shelf: readParam(params.shelf),
    category: readParam(params.category),
    lowStock: readParam(params.lowStock) === 'true',
  };

  const supabase = await createSupabaseServerClient();
  const currentUser = await getCurrentUser(supabase);
  const canWrite = currentUser ? WRITE_ROLES.includes(currentUser.profile.role) : false;

  const [products, shelves, categories] = await Promise.all([
    getAllProducts(supabase, filters),
    getAllShelves(supabase),
    getAllCategories(supabase),
  ]);

  const exportHref = `/api/products/export?${buildQuery(filters)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-900">Ürünler</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {formatQuantity(products.length)} ürün listeleniyor.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={exportHref}
            className="rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm font-bold text-zinc-700"
          >
            CSV indir
          </a>
          {canWrite ? (
            <>
              <Link
                href="/products/import"
                className="rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm font-bold text-zinc-700"
              >
                CSV yükle
              </Link>
              <Link
                href="/products/new"
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                Yeni ürün
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <ProductFilters
        shelves={shelves}
        categories={categories}
        initial={{
          search: filters.search ?? '',
          shelf: filters.shelf ?? '',
          category: filters.category ?? '',
          lowStock: filters.lowStock ?? false,
        }}
      />

      {products.length === 0 ? (
        <p className="rounded-3xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 shadow-sm">
          Bu filtrelere uyan ürün yok.
        </p>
      ) : (
        <ul className="space-y-2">
          {products.map((product) => (
            <li key={product.id}>
              <Link
                href={`/products/${product.id}/edit`}
                className="block rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-emerald-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-zinc-900">{product.name}</p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {product.shelf_location}
                      {' · '}
                      <span className="font-mono">{product.code}</span>
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-black text-emerald-700">
                      {formatCurrency(product.sale_price)}
                    </p>
                    <p
                      className={`mt-0.5 text-xs font-bold ${
                        product.stock_quantity === 0
                          ? 'text-rose-600'
                          : product.is_low_stock
                            ? 'text-amber-600'
                            : 'text-zinc-500'
                      }`}
                    >
                      {product.stock_quantity === 0
                        ? 'Tükendi'
                        : `${formatQuantity(product.stock_quantity)} ${product.unit}`}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
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

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();

  if (filters.search) params.set('search', filters.search);
  if (filters.shelf) params.set('shelf', filters.shelf);
  if (filters.category) params.set('category', filters.category);
  if (filters.lowStock) params.set('lowStock', 'true');

  return params.toString();
}
