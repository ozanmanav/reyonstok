import type { Metadata } from 'next';
import Link from 'next/link';
import ProductForm, { type ProductFormValues } from '@/components/ProductForm';
import { getCurrentUser, WRITE_ROLES } from '@/lib/auth';
import { getNextProductCode } from '@/lib/repo/products';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Yeni ürün - ReyonStok',
};

/**
 * Yeni ürün kaydı.
 *
 * Tarama ekranında bulunamayan bir kod okunduğunda buraya `?code=` veya
 * `?barcode=` ile geliniyor; okunan değer doğru alana yerleşiyor, personel
 * kodu elle kopyalamak zorunda kalmıyor.
 */
export default async function NewProductPage({ searchParams }: PageProps<'/products/new'>) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const currentUser = await getCurrentUser(supabase);

  if (!currentUser || !WRITE_ROLES.includes(currentUser.profile.role)) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-black text-zinc-900">Ürün ekleme yetkiniz yok</h1>
        <p className="mt-1.5 text-sm text-zinc-600">
          Yeni ürün kaydı için mağaza yöneticisine başvurun.
        </p>
        <Link
          href="/scan"
          className="mt-4 inline-block rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white"
        >
          Tarama ekranına dön
        </Link>
      </div>
    );
  }

  const scannedCode = typeof params.code === 'string' ? params.code : '';
  const scannedBarcode = typeof params.barcode === 'string' ? params.barcode : '';

  // Kod okunmadıysa sıradaki kodu öneriyoruz; personel boş alan görmesin.
  const suggestedCode = scannedCode || (await getNextProductCode(supabase));

  const initial: ProductFormValues = {
    code: suggestedCode,
    barcode: scannedBarcode,
    name: '',
    category: '',
    shelf_location: '',
    cost_price: '',
    sale_price: '',
    stock_quantity: '',
    min_stock_alert: '',
    unit: '',
    notes: '',
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">Yeni ürün</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {scannedBarcode
            ? 'Okunan barkod alana yerleştirildi, kalan bilgileri doldurun.'
            : 'Ürün bilgilerini girin. Kod alanını boş bırakırsanız otomatik verilir.'}
        </p>
      </div>

      <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <ProductForm mode="create" initial={initial} />
      </div>
    </div>
  );
}
