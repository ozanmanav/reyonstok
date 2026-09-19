// @vitest-environment node

import QRCode from 'qrcode';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildLabelPayload } from '@/lib/label';
import { QR_ENCODE_OPTIONS } from '@/lib/qr';
import { buildScanUrl, normalizeScan } from '@/lib/scan-code';
import { createDetector } from '@/lib/scanner/detector';

/**
 * WASM tabanlı yedek çözümleyicinin gerçekten kod okuduğunu doğrular.
 *
 * Bu yol iOS Safari'de kullanılacak tek yol (orada yerleşik `BarcodeDetector`
 * yok), dolayısıyla çalıştığından emin olmak gerekiyor. Test yerleşik uygulamayı
 * bilinçli olarak devre dışı bırakıp (`native: undefined`) ponyfill'i zorluyor.
 *
 * Görüntü kaynağı olarak `Blob` veriliyor: ponyfill Blob'u doğrudan ZXing'e
 * aktardığı için tarayıcıya özgü DOM API'lerine ihtiyaç duymuyoruz.
 *
 * Kamera akışıyla gerçek okuma yalnızca cihazda doğrulanabilir; o adım Task 11
 * kapsamında elle yapılacak.
 *
 * Ortam seçimi hakkında: Node ortamında `globalThis.Image` bulunmadığı için
 * ponyfill Blob'u doğrudan ZXing'e aktarıyor ve görüntüyü kendisi çözüyor, yani
 * çözümleme gerçekten yapılıyor. jsdom'da ise `Image` var ama jsdom görüntü
 * çözemediği için okuma hiç başlamıyor. Bu yüzden Node ortamı kullanılıyor ve
 * yalnızca kütüphanenin sonucu biçimlendirmek için kullandığı `DOMRectReadOnly`
 * tipi sağlanıyor.
 */

beforeAll(() => {
  const globals = globalThis as { DOMRectReadOnly?: unknown };

  globals.DOMRectReadOnly ??= class {
    constructor(
      readonly x = 0,
      readonly y = 0,
      readonly width = 0,
      readonly height = 0,
    ) {}
  };
});

/**
 * Verilen metni karekoda çevirip PNG Blob'u döndürür.
 *
 * Kodlama ayarları etiket basımıyla aynı (`QR_ENCODE_OPTIONS`): böylece burada
 * çözümlenen simge, gerçekten rafa yapıştırılan simgenin aynısı oluyor.
 */
async function qrBlob(text: string): Promise<Blob> {
  const png = await QRCode.toBuffer(text, {
    ...QR_ENCODE_OPTIONS,
    // Çözümleyicinin rahat okuması için yeterince büyük.
    width: 512,
  });

  return new Blob([new Uint8Array(png)], { type: 'image/png' });
}

describe('WASM çözümleyici', () => {
  test('yerleşik uygulama yoksa WASM yolunu seçer', async () => {
    const detector = await createDetector({ native: undefined });

    expect(detector.source).toBe('wasm');
  });

  test('ürün karekodunu okur', async () => {
    const detector = await createDetector({ native: undefined });

    const codes = await detector.detect(await qrBlob('ENV-1001'));

    expect(codes).toHaveLength(1);
    expect(codes[0]?.rawValue).toBe('ENV-1001');
    expect(codes[0]?.format).toBe('qr_code');
  });

  test('etiketteki adres karekodunu okur ve kod çözümlenir', async () => {
    // Etiket basımı (buildScanUrl) ile tarama arasındaki tur: telefonun kendi
    // kamera uygulaması bu karekodu okuduğunda ürün sayfası açılacak.
    const detector = await createDetector({ native: undefined });
    const url = buildScanUrl('ENV-1042', 'https://reyonstok.vercel.app');

    const codes = await detector.detect(await qrBlob(url));

    expect(codes[0]?.rawValue).toBe(url);
    expect(normalizeScan(codes[0]?.rawValue ?? '').code).toBe('ENV-1042');
  });

  test('etikete basılan değer, adres tanımlı olmasa da ürün koduna çözülür', async () => {
    // Etikete basılan metni üreten fonksiyonun kendisi kullanılıyor: basım ile
    // tarama arasındaki sözleşme burada kilitleniyor. Adres tanımsızsa etikete
    // düz ürün kodu basılıyor; o etiketin de uygulama içinden okunabilmesi
    // gerekiyor.
    const detector = await createDetector({ native: undefined });

    for (const siteUrl of ['https://reyonstok.vercel.app', '']) {
      const payload = buildLabelPayload('ENV-2024', siteUrl);

      const codes = await detector.detect(await qrBlob(payload));

      expect(codes[0]?.rawValue).toBe(payload);
      expect(normalizeScan(codes[0]?.rawValue ?? '')).toMatchObject({
        kind: 'qr',
        code: 'ENV-2024',
      });
    }
  });

  test('karekod içindeki barkod değerini de çözer', async () => {
    const detector = await createDetector({ native: undefined });

    const codes = await detector.detect(await qrBlob('4006381333931'));

    expect(normalizeScan(codes[0]?.rawValue ?? '')).toMatchObject({
      kind: 'ean13',
      code: '4006381333931',
    });
  });

  test('kod içermeyen görüntüde boş liste döner', async () => {
    // ZXing bu durumda rawValue: '' ve format: 'unknown' olan bir sonuç
    // döndürüyor; çözümleyici katmanı bunu süzüyor, aksi halde tarayıcı boş kod
    // okumuş gibi davranırdı.
    const detector = await createDetector({ native: undefined });
    // Düz beyaz 1x1 PNG.
    const blank = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFDAAAAAElFTkSuQmCC',
      'base64',
    );

    const codes = await detector.detect(new Blob([new Uint8Array(blank)], { type: 'image/png' }));

    expect(codes).toEqual([]);
  });
});
