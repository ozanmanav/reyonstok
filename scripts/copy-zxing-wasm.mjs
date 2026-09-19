/**
 * ZXing WebAssembly dosyasını `public/` altına kopyalar.
 *
 * Neden gerekli: `barcode-detector` paketi, WASM ikilisini varsayılan olarak
 * jsDelivr CDN'inden indiriyor. iOS Safari'de tarama tamamen bu dosyaya bağlı
 * olduğundan, mağaza ağı CDN'i engellerse ya da yavaşsa barkod okuma hiç
 * çalışmaz. Dosyayı kendi alan adımızdan servis ederek çalışma anındaki dış
 * bağımlılığı kaldırıyoruz.
 *
 * Betik `predev` ve `prebuild` adımlarında çalışıyor; böylece paket sürümü
 * değiştiğinde kopya da kendiliğinden güncellenir ve depoda eskiyen bir ikili
 * dosya kalmaz (bu yüzden `public/zxing/` git'e girmiyor).
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SOURCE = path.join(
  process.cwd(),
  'node_modules',
  'zxing-wasm',
  'dist',
  'reader',
  'zxing_reader.wasm',
);
const TARGET_DIR = path.join(process.cwd(), 'public', 'zxing');
const TARGET = path.join(TARGET_DIR, 'zxing_reader.wasm');

try {
  await stat(SOURCE);
} catch {
  console.error(
    `ZXing WASM dosyası bulunamadı: ${SOURCE}\n` +
      'Bağımlılıklar kurulu mu? `npm install` çalıştırıp tekrar deneyin.',
  );
  process.exit(1);
}

await mkdir(TARGET_DIR, { recursive: true });
await copyFile(SOURCE, TARGET);

const { size } = await stat(TARGET);
console.log(`ZXing okuyucusu kopyalandı (${(size / 1024 / 1024).toFixed(2)} MB): public/zxing/`);
