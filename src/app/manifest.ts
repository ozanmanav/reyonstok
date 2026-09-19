import type { MetadataRoute } from 'next';

/**
 * Uygulama manifesti (/manifest.webmanifest).
 *
 * Personel uygulamayı telefonun ana ekranına ekleyip tarayıcı çubuğu olmadan
 * kullanacak. Bu mağazada işe yarar bir fark: adres çubuğu ve sekmeler ekranın
 * yaklaşık %15'ini yiyor, karekod tarama ekranında o alan kameraya gidiyor.
 *
 * `display: 'standalone'` iOS'ta da destekliyor ama Safari bunun için ayrıca
 * `apple-mobile-web-app-capable` meta etiketini istiyor; o etiket layout.tsx
 * içindeki `appleWebApp` ayarından geliyor.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ReyonStok - Mağaza Karekod, Fiyat ve Stok Takibi',
    short_name: 'ReyonStok',
    description:
      'Reyon etiketindeki karekodu telefonla okutup ürünün fiyatını ve stoğunu görün, tek dokunuşla düzeltin.',
    lang: 'tr',
    dir: 'ltr',
    start_url: '/',
    // Oturum yoksa proxy zaten /login'e yönlendiriyor; başlangıç adresi ana
    // panel kalıyor ki giriş yapmış personel doğrudan panele düşsün.
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#18181b',
    theme_color: '#18181b',
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // Android ikonu daire/squircle olarak kırpıyor; kırpmaya dayanıklı
        // varyant olmadan desenin kenarları kesiliyor.
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Karekod tara',
        short_name: 'Tara',
        description: 'Reyon etiketini veya ürün barkodunu okut',
        url: '/scan',
      },
      {
        name: 'Ürünler',
        short_name: 'Ürünler',
        description: 'Ürün listesini aç',
        url: '/products',
      },
    ],
  };
}
