/**
 * PWA ikonlarını public/icons/*.svg kaynaklarından PNG olarak üretir.
 *
 * Neden betik: ikonlar birkaç boyutta ve iki varyantta (normal + maskable)
 * gerekiyor; elle üretilen PNG'ler tasarım değişince sessizce eskiyor.
 *
 * Neden Chrome: bağımlılık eklemeden SVG rasterleştirmenin en güvenilir yolu.
 * Üretilen PNG'ler depoya COMMİTLENİYOR, yani bu betik yalnızca ikon tasarımı
 * değiştiğinde ve yalnızca geliştirme makinesinde çalıştırılıyor; derleme ve
 * dağıtım Chrome'a bağımlı değil.
 *
 * Kullanım: node scripts/generate-icons.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** Üretilecek dosyalar: [kaynak SVG, hedef PNG, kenar uzunluğu]. */
const TARGETS = [
  // Next.js dosya kuralları: bunlar otomatik olarak <link rel="icon"> ve
  // <link rel="apple-touch-icon"> etiketlerine dönüşüyor.
  ['public/icons/icon.svg', 'src/app/icon.png', 512],
  ['public/icons/icon.svg', 'src/app/apple-icon.png', 180],
  // Manifest'in gösterdiği dosyalar.
  ['public/icons/icon.svg', 'public/icons/icon-192.png', 192],
  ['public/icons/icon.svg', 'public/icons/icon-512.png', 512],
  ['public/icons/icon-maskable.svg', 'public/icons/icon-maskable-512.png', 512],
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });

      return candidate;
    } catch {
      // Sıradakini dene.
    }
  }

  throw new Error(
    'Chrome/Chromium bulunamadı. İkonları yeniden üretmek için Chrome gerekiyor;\n' +
      'PNG dosyaları depoda hazır olduğu için normal geliştirmede bu betik gerekmez.',
  );
}

const chrome = findChrome();
const workDir = mkdtempSync(join(tmpdir(), 'reyonstok-icons-'));

try {
  for (const [source, output, size] of TARGETS) {
    const svg = readFileSync(resolve(source), 'utf8');

    // SVG'yi tam olarak istenen ölçüde bir sayfaya oturtuyoruz: kenar boşluğu
    // veya kaydırma çubuğu kalırsa ikon bir piksel kayıyor.
    const html = `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; width: ${size}px; height: ${size}px; }
</style>
${svg}`;

    const page = join(workDir, `page-${size}-${output.replace(/\W/g, '_')}.html`);
    writeFileSync(page, html);

    execFileSync(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--window-size=${size},${size}`,
        `--screenshot=${resolve(output)}`,
        `file://${page}`,
      ],
      { stdio: 'ignore' },
    );

    console.log(`${output} (${size}x${size})`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
