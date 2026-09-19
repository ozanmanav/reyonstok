import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import { getCurrentUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'ReyonStok - Mağaza Karekod, Fiyat ve Stok Takibi',
  description:
    'Mağaza reyonlarındaki karekodları telefonla okutup ürünün fiyatını, stoğunu ve bilgisini gören, stok düzeltmesi yapan mobil uygulama.',
  applicationName: 'ReyonStok',
  // iOS, manifest'teki display: standalone ayarını tek başına yeterli
  // görmüyor; ana ekrana eklenen uygulamanın tarayıcı çubuğu olmadan açılması
  // için bu meta etiketleri gerekiyor.
  appleWebApp: {
    capable: true,
    title: 'ReyonStok',
    // 'black-translucent' içeriği durum çubuğunun ALTINA kaydırıyor. Gezinme
    // çubuğunda güvenli alan dolgusu var ama giriş sayfasında çubuk yok; saat
    // ve pil simgesi e-posta alanının üstüne binerdi.
    statusBarStyle: 'default',
  },
  // Uygulama yalnızca oturumla kullanılıyor, arama sonuçlarında yeri yok.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Ana ekrana eklendiğinde çentikli ekranlarda tam genişlik kullanılsın
  viewportFit: 'cover',
  themeColor: '#18181b',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Oturum bilgisi gezinme çubuğu için gerekli. Giriş sayfasında kullanıcı
  // olmadığı için çubuk gizlenir.
  const supabase = await createSupabaseServerClient();
  const currentUser = await getCurrentUser(supabase);

  return (
    <html lang="tr" className="h-full bg-zinc-100 text-zinc-900">
      <body className="font-sans antialiased min-h-full flex flex-col selection:bg-emerald-500 selection:text-white">
        {currentUser ? (
          <Navbar
            fullName={currentUser.profile.full_name}
            email={currentUser.profile.email}
            role={currentUser.profile.role}
          />
        ) : null}

        {/*
          Baskıda kabuk ölçüleri kaldırılıyor: sayfa kenar boşluklarını
          `@page` kuralı veriyor, içerik genişliği kağıdın tamamı olmalı.
        */}
        <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 pb-safe print:max-w-none print:p-0">
          {children}
        </main>
      </body>
    </html>
  );
}
