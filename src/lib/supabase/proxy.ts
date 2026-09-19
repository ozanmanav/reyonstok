import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { AUTH_COOKIE_OPTIONS } from './cookies';
import { supabaseAnonKey, supabaseUrl } from './env';

/**
 * Proxy katmanı için Supabase istemcisi ve oturum yenileme.
 *
 * Supabase belirteçleri kısa ömürlü. Yenilenen belirteci tarayıcıya geri
 * yazacak tek yer proxy: Server Component render'ı sırasında çerez yazılamıyor.
 * Bu yüzden her istekte burada `getUser()` çağrılıp, yenilenen çerezler hem
 * isteğe hem yanıta işlenir.
 *
 * Yanıt nesnesi geri döndürülmek zorunda: `setAll` içinde yeniden oluşturulan
 * yanıtın dışarıya verilmemesi, oturumun sessizce düşmesine yol açar.
 */
export async function refreshSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: User | null;
}> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Önce isteğe yaz: aynı istek içinde çalışacak kod güncel çerezi görsün.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        // Yanıtı yeniden oluştur, sonra çerezleri üzerine işle.
        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() belirteci kimlik sunucusunda doğrular ve gerekiyorsa yeniler.
  // getSession() yalnızca çereze güvendiği için burada kullanılmaz.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
