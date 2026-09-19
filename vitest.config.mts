import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Entegrasyon testleri Supabase projesine bağlanıyor. `.env.local` dosyasındaki
// değişkenleri (Vercel'den `vercel env pull` ile geliyor) test sürecine taşıyoruz.
// Boş önek, NEXT_PUBLIC_ olmayan sunucu anahtarlarının da yüklenmesini sağlar.
const env = loadEnv('test', process.cwd(), '');

export default defineConfig({
  plugins: [react()],
  // `@/*` takma adları tsconfig.json'dan okunur (Vite 8 yerel desteği).
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    env,
    // Varsayılan ortam jsdom (bileşen testleri). Supabase'e karşı çalışan
    // entegrasyon testleri dosya başında `// @vitest-environment node` ile
    // kendi ortamını seçer.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**'],
    // Entegrasyon testleri gerçek veritabanına gidiyor, ağ gecikmesi payı.
    testTimeout: 30_000,
    // HTTP testleri tek paylaşımlı `next dev` sunucusu kullanıyor: iki ayrı
    // sunucu aynı `.next` dizini için çekişip birbirini bozuyor.
    globalSetup: ['./tests/global-setup.ts'],
    /**
     * Test dosyaları sırayla çalışır.
     *
     * Entegrasyon testleri tek bir bulut Supabase projesini paylaşıyor. Paralel
     * çalıştıklarında üç ayrı yarış ortaya çıktı:
     *  - `inventory_stats` gibi toplam sayıları önce/sonra karşılaştıran testler,
     *    başka bir dosya ürün eklediğinde yanlış sonuç veriyor.
     *  - Aynı anda çok sayıda test kullanıcısı açılması kimlik doğrulama
     *    hız sınırına takılıyor.
     *  - Satır kilidi testi zamanlamaya duyarlı; veritabanı yük altındayken
     *    beklenen sıralama bozuluyor.
     * Sıralı çalıştırma süreyi yaklaşık iki katına çıkarıyor ama testler
     * güvenilir oluyor; rastgele düşen bir takım hiç test olmamasından kötüdür.
     */
    fileParallelism: false,
  },
});
