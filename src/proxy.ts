import { NextResponse, type NextRequest } from 'next/server';
import { refreshSession } from '@/lib/supabase/proxy';

/**
 * Her istekten önce çalışan katman (Next.js 16'da `middleware` yerine `proxy`).
 *
 * İki iş yapıyor:
 *  1. Supabase oturum belirtecini yeniler ve yenilenen çerezi yanıta yazar.
 *     Bunu yapabilecek tek yer burası; Server Component render'ı sırasında
 *     çerez yazılamıyor.
 *  2. Oturumu olmayan isteği /login'e, oturumu olan isteği /login'den ana
 *     sayfaya yönlendirir.
 *
 * Buradaki yönlendirme iyimser bir kontrol: kullanıcı deneyimi için hızlı ve
 * ucuz. Gerçek yetkilendirme veri katmanında (requireUser/requireRole) ve
 * veritabanındaki RLS politikalarında yapılır; Next.js dokümanı da proxy'nin
 * tek başına yetkilendirme çözümü olarak kullanılmamasını söylüyor.
 */

/** Oturum gerektirmeyen yollar. */
const PUBLIC_PATHS = ['/login', '/auth'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const { response, user } = await refreshSession(request);
  const { pathname, search } = request.nextUrl;

  // API uçları kendi 401/403 yanıtlarını üretiyor; HTML yönlendirmesi
  // istemcideki fetch çağrılarını yanıltırdı.
  if (pathname.startsWith('/api/')) {
    return response;
  }

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL('/login', request.url);

    // Giriş sonrası kullanıcıyı gitmek istediği sayfaya döndürebilmek için.
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', `${pathname}${search}`);
    }

    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  /**
   * Statik dosyalar hariç her yol. Eşleştirme yazılmazsa proxy `_next/static` ve
   * `public/` içeriğini de karşılar; oturum kontrolü CSS ve ikonları engeller.
   *
   * `zxing/` özellikle dışarıda: barkod okuyucunun 1 MB'lık WebAssembly dosyası
   * burada duruyor ve her istekte oturum doğrulamasından geçirmek gereksiz
   * gecikme demek. Dosya gizli bir veri içermiyor, genel bir kütüphane.
   *
   * `icon.png` ve `apple-icon.png`, Next.js'in app dizini kuralıyla ürettiği
   * simge yolları. Listede olmasalardı giriş yapmamış tarayıcı simgeyi isterken
   * /login'e yönlendirilir; giriş sayfası simgesiz görünür ve telefon "ana
   * ekrana ekle" sırasında ikonu alamazdı.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|icons/|zxing/).*)',
  ],
};
