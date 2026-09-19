import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_OPTIONS } from './cookies';
import { supabaseAnonKey, supabaseUrl } from './env';

/**
 * Sunucu tarafı Supabase istemcisi (Server Component, Route Handler, Server Action).
 *
 * Her istek için yeni istemci oluşturulur; istemciler istekler arasında
 * paylaşılmaz, aksi halde bir kullanıcının oturumu başkasına sızabilir.
 *
 * Kullanıcının oturum çerezini taşıdığı için veritabanı sorguları RLS
 * politikalarına tabidir: uygulama kodunda bir yetki kontrolü atlanırsa
 * veritabanı ikinci savunma hattı olarak devreye girer.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component render'ı sırasında çerez yazılamaz. Oturum
          // yenilemesi src/proxy.ts içinde yapıldığı için bu durum güvenli;
          // buradaki hatayı yutmak beklenen davranış.
        }
      },
    },
  });
}
