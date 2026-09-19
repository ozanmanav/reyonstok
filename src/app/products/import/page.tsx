import type { Metadata } from 'next';
import Link from 'next/link';
import ImportScreen from './ImportScreen';
import { getCurrentUser, WRITE_ROLES } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'CSV yükle - ReyonStok',
};

/**
 * CSV ile toplu ürün aktarma.
 *
 * Yetki kontrolü hem burada hem API ucunda: sayfayı gizlemek yeterli değil,
 * uç doğrudan da çağrılabilir.
 */
export default async function ImportPage() {
  const supabase = await createSupabaseServerClient();
  const currentUser = await getCurrentUser(supabase);

  if (!currentUser || !WRITE_ROLES.includes(currentUser.profile.role)) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-black text-zinc-900">İçe aktarma yetkiniz yok</h1>
        <p className="mt-1.5 text-sm text-zinc-600">
          Toplu ürün aktarma için mağaza yöneticisine başvurun.
        </p>
        <Link
          href="/products"
          className="mt-4 inline-block rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white"
        >
          Ürün listesine dön
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">CSV yükle</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Ürünleri toplu ekleyin veya güncelleyin. Ürün kodu eşleşen satırlar güncellenir.
        </p>
      </div>

      <ImportScreen />
    </div>
  );
}
