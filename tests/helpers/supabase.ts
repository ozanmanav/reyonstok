import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/types';

/**
 * Entegrasyon testleri için Supabase yardımcıları.
 *
 * Testler gerçek Supabase projesine bağlanır; amaç RLS politikalarının ve
 * atomik stok fonksiyonunun gerçekten çalıştığını doğrulamak. Yerel Docker
 * yığını kullanılmıyor.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Ortam değişkenleri yoksa testlerin sessizce geçmesini engelle. */
export function requireTestEnv(): {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
} {
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      'Entegrasyon testleri için .env.local gerekli. `vercel env pull .env.local` çalıştırın.',
    );
  }

  return { url, anonKey, serviceRoleKey };
}

/**
 * RLS'i tamamen aşan yönetim istemcisi. Yalnızca test verisi hazırlamak ve
 * temizlemek için kullanılır, doğrulamalar kullanıcı istemcisiyle yapılır.
 */
export function createAdminClient(): SupabaseClient {
  const env = requireTestEnv();

  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

/**
 * Verilen rolde giriş yapmış bir test kullanıcısı oluşturur.
 *
 * Kullanıcı Auth'ta açılır (trigger profili viewer olarak yaratır), sonra rolü
 * yönetim istemcisiyle istenen değere çekilir ve kullanıcı adına oturum açılır.
 * Dönen `client`, anon anahtar + kullanıcı oturumu kullandığı için RLS'e tabidir.
 */
export async function createTestUser(role: UserRole): Promise<TestUser> {
  const env = requireTestEnv();
  const admin = createAdminClient();

  const email = `test-${role}-${crypto.randomUUID()}@reyonstok.test`;
  const password = `Test-${crypto.randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Test ${role}` },
  });

  if (createError || !created.user) {
    throw new Error(`Test kullanıcısı oluşturulamadı: ${createError?.message}`);
  }

  const { error: roleError } = await admin
    .from('profiles')
    .update({ role })
    .eq('id', created.user.id);

  if (roleError) {
    throw new Error(`Test kullanıcısının rolü ayarlanamadı: ${roleError.message}`);
  }

  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`Test kullanıcısı giriş yapamadı: ${signInError.message}`);
  }

  return { id: created.user.id, email, password, client };
}

/**
 * Kullanıcı adına oturum açıp, uygulamanın kullandığı çerez başlığını üretir.
 *
 * Çerezleri elle biçimlendirmek yerine `@supabase/ssr`'ın kendi `setAll`
 * mekanizmasını kullanıyoruz: böylece test, kütüphanenin iç çerez biçimine
 * (parçalama, base64url kodlaması) bağımlı olmadan uygulamanın gerçekten
 * göreceği çerezleri üretir.
 *
 * Bu sayede oturum açılmış HTTP istekleri Playwright kurulmadan test edilebilir.
 */
export async function createSessionCookieHeader(email: string, password: string): Promise<string> {
  const env = requireTestEnv();
  const jar = new Map<string, string>();

  const client = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return [...jar].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          jar.set(name, value);
        }
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Oturum çerezi üretilemedi: ${error.message}`);
  }

  if (jar.size === 0) {
    throw new Error('Oturum açıldı ancak çerez yazılmadı');
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Test kullanıcısını ve trigger ile açılan profilini siler. */
export async function deleteTestUser(user: TestUser): Promise<void> {
  const admin = createAdminClient();
  await user.client.auth.signOut();
  await admin.auth.admin.deleteUser(user.id);
}

let productCounter = 0;

/** Testler arasında çakışmayan benzersiz ürün kodu üretir. */
export function uniqueProductCode(): string {
  productCounter += 1;

  return `TEST-${Date.now()}-${productCounter}`.toUpperCase();
}

export interface SeedProductOptions {
  code?: string;
  barcode?: string | null;
  name?: string;
  shelf_location?: string;
  category?: string;
  sale_price?: number;
  cost_price?: number;
  stock_quantity?: number;
  min_stock_alert?: number;
}

/** Yönetim istemcisiyle test ürünü oluşturur ve id'sini döndürür. */
export async function seedProduct(options: SeedProductOptions = {}): Promise<{
  id: number;
  code: string;
}> {
  const admin = createAdminClient();
  const code = options.code ?? uniqueProductCode();

  const { data, error } = await admin
    .from('products')
    .insert({
      code,
      barcode: options.barcode ?? null,
      name: options.name ?? 'Test Ürünü',
      category: options.category ?? 'Test',
      shelf_location: options.shelf_location ?? 'Test Reyonu',
      cost_price: options.cost_price ?? 10,
      sale_price: options.sale_price ?? 20,
      stock_quantity: options.stock_quantity ?? 10,
      min_stock_alert: options.min_stock_alert ?? 3,
    })
    .select('id, code')
    .single();

  if (error || !data) {
    throw new Error(`Test ürünü oluşturulamadı: ${error?.message}`);
  }

  return data as { id: number; code: string };
}

/** Test ürünlerini (ve bağlı hareket kayıtlarını) siler. */
export async function deleteProducts(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const admin = createAdminClient();
  await admin.from('products').delete().in('id', ids);
}
