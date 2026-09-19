import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServiceRoleKey, supabaseUrl } from './env';

/**
 * Yönetim istemcisi: RLS'i tamamen aşar.
 *
 * `server-only` içe aktarımı, bu modülün yanlışlıkla bir istemci bileşenine
 * girmesi durumunda derlemeyi başarısız kılar; böylece yönetim anahtarı
 * tarayıcıya sızamaz.
 *
 * Yalnızca uygulama içinden yapılamayan işlemler için kullanılır: personel
 * hesabı açmak ve silmek (Supabase Auth yönetim API'si). Ürün ve stok
 * işlemlerinde kullanılmaz; oradaki yetki kontrolü RLS'e bırakılır.
 *
 * Bu istemciyi kullanan her çağrı, öncesinde `requireRole(..., ADMIN_ROLES)`
 * ile yetki kontrolünden geçmek zorundadır.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
