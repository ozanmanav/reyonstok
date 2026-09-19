import type { CookieOptions } from '@supabase/ssr';

/**
 * Oturum çerezinin ayarları.
 *
 * `@supabase/ssr` varsayılan olarak `httpOnly: false` kullanıyor, çünkü
 * tarayıcıdaki Supabase istemcisinin oturumu okuması gerekebiliyor. Bu
 * uygulamada tarayıcı hiçbir zaman Supabase'e doğrudan bağlanmıyor; tüm veri
 * kendi API uçlarımızdan geçiyor. Dolayısıyla çerezi JavaScript'e kapatmak
 * bedava bir güvenlik kazancı: siteye bir XSS girse bile oturum belirteci
 * okunamaz.
 *
 * `secure` bayrağı yalnızca üretimde: yerelde http://localhost üzerinde
 * çalıştığımız için açık bırakılsa tarayıcı çerezi hiç göndermez ve giriş
 * çalışmaz. Vercel her zaman HTTPS sunduğu için üretimde sorun olmuyor; yerelde
 * üretim derlemesini denemek isterseniz (`next start`) giriş çalışmaz, bunun
 * için `npm run dev` kullanın.
 *
 * Bu ayarların hem sunucu istemcisinde hem proxy katmanında BİREBİR aynı olması
 * gerekiyor; farklı olursa aynı ada sahip iki çerez oluşup oturum kararsızlaşır.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  path: '/',
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // Supabase'in varsayılanı (yaklaşık 400 gün). Mağaza personelinin her gün
  // yeniden giriş yapmasını istemiyoruz; oturum iptali `is_active` alanı
  // üzerinden yapılıyor.
  maxAge: 34_560_000,
};
