import type { Metadata } from 'next';
import { getCurrentUser, WRITE_ROLES } from '@/lib/auth';
import { getProductByCode } from '@/lib/repo/products';
import { getStockLogsForProduct } from '@/lib/repo/stock-logs';
import { normalizeScan } from '@/lib/scan-code';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import ScanScreen, { type InitialLookup } from './ScanScreen';

export const metadata: Metadata = {
  title: 'Tara - ReyonStok',
};

/**
 * Tarama ekranı.
 *
 * `?code=` parametresi iki yerden gelebilir: reyon etiketindeki karekodu
 * telefonun kendi kamera uygulaması okuduğunda ve uygulama içinden bağlantıyla
 * gelindiğinde. Bu durumda ürün sunucuda getirilip sayfayla birlikte geliyor;
 * personel etiketi okuttuğunda ek bir istek beklemiyor.
 *
 * Yazma yetkisi de sunucuda belirleniyor ve aşağı geçiyor; arayüzde
 * kullanılamayan butonları göstermemek için. Gerçek yetki kontrolü API ucunda
 * ve veritabanı politikalarında.
 */
export default async function ScanPage({ searchParams }: PageProps<'/scan'>) {
  const params = await searchParams;
  const rawCode = typeof params.code === 'string' ? params.code : undefined;

  const supabase = await createSupabaseServerClient();
  const currentUser = await getCurrentUser(supabase);
  const canWrite = currentUser ? WRITE_ROLES.includes(currentUser.profile.role) : false;

  const initialLookup = rawCode ? await lookupInitialCode(supabase, rawCode) : undefined;

  return <ScanScreen initialCode={rawCode} initialLookup={initialLookup} canWrite={canWrite} />;
}

/** Adresle gelen kodu sunucuda çözüp ürünü ve hareketlerini hazırlar. */
async function lookupInitialCode(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  rawCode: string,
): Promise<InitialLookup | undefined> {
  const scan = normalizeScan(rawCode);
  if (scan.code === '') {
    return undefined;
  }

  const product = await getProductByCode(supabase, rawCode);
  if (!product) {
    return { status: 'missing' };
  }

  const logs = await getStockLogsForProduct(supabase, product.id);

  return { status: 'found', product, logs };
}
