import { describe, expect, test, vi } from 'vitest';
import {
  type BarcodeDetectorConstructor,
  createDetector,
  nativeSupportsRequiredFormats,
  SCANNER_FORMATS,
} from './detector';

/**
 * Sahte çözümleyici üretir.
 *
 * @param supportedFormats `getSupportedFormats` yanıtı; null verilirse metot hiç
 * tanımlanmaz (eski uygulama taklidi).
 */
function fakeDetector(options: {
  supportedFormats?: readonly string[] | null;
  results?: { rawValue: string; format: string }[];
  formatsThrow?: boolean;
}): BarcodeDetectorConstructor & { lastFormats?: string[] } {
  class Fake {
    /** Kurucuya geçirilen biçim listesini testin görebilmesi için saklar. */
    static lastFormats?: string[];

    constructor(constructorOptions?: { formats?: string[] }) {
      Fake.lastFormats = constructorOptions?.formats;
    }

    async detect() {
      return options.results ?? [];
    }
  }

  if (options.formatsThrow) {
    (Fake as unknown as BarcodeDetectorConstructor).getSupportedFormats = () =>
      Promise.reject(new Error('biçim listesi alınamadı'));
  } else if (options.supportedFormats !== null) {
    (Fake as unknown as BarcodeDetectorConstructor).getSupportedFormats = async () =>
      options.supportedFormats ?? [];
  }

  return Fake as unknown as BarcodeDetectorConstructor & { lastFormats?: string[] };
}

describe('nativeSupportsRequiredFormats', () => {
  test('gerekli biçimler varsa kabul eder', async () => {
    const native = fakeDetector({ supportedFormats: ['qr_code', 'ean_13', 'ean_8'] });

    expect(await nativeSupportsRequiredFormats(native)).toBe(true);
  });

  test('karekod desteği yoksa reddeder', async () => {
    const native = fakeDetector({ supportedFormats: ['ean_13'] });

    expect(await nativeSupportsRequiredFormats(native)).toBe(false);
  });

  test('EAN-13 desteği yoksa reddeder', async () => {
    // Yalnızca karekod okuyan bir tarayıcı, ürün barkodlarını okuyamaz.
    const native = fakeDetector({ supportedFormats: ['qr_code'] });

    expect(await nativeSupportsRequiredFormats(native)).toBe(false);
  });

  test('yerleşik uygulama yoksa reddeder', async () => {
    expect(await nativeSupportsRequiredFormats(undefined)).toBe(false);
  });

  test('getSupportedFormats tanımlı değilse reddeder', async () => {
    const native = fakeDetector({ supportedFormats: null });

    expect(await nativeSupportsRequiredFormats(native)).toBe(false);
  });

  test('biçim listesi hata verirse reddeder', async () => {
    const native = fakeDetector({ formatsThrow: true });

    expect(await nativeSupportsRequiredFormats(native)).toBe(false);
  });
});

describe('createDetector', () => {
  test('yerleşik uygulama yeterliyse onu kullanır ve ponyfill yüklemez', async () => {
    const native = fakeDetector({ supportedFormats: [...SCANNER_FORMATS] });
    const loadPonyfill = vi.fn();

    const detector = await createDetector({ native, loadPonyfill });

    expect(detector.source).toBe('native');
    expect(loadPonyfill).not.toHaveBeenCalled();
  });

  test('yerleşik uygulama yoksa ponyfill yükler', async () => {
    const ponyfill = fakeDetector({ supportedFormats: [...SCANNER_FORMATS] });
    const loadPonyfill = vi.fn(async () => ponyfill);

    const detector = await createDetector({ native: undefined, loadPonyfill });

    expect(detector.source).toBe('wasm');
    expect(loadPonyfill).toHaveBeenCalledOnce();
  });

  test('yerleşik uygulama eksik biçim desteğiyle geliyorsa ponyfill yükler', async () => {
    // iOS dışında da olabilir: bazı Android sürümleri yalnızca karekod okuyor.
    const native = fakeDetector({ supportedFormats: ['qr_code'] });
    const ponyfill = fakeDetector({ supportedFormats: [...SCANNER_FORMATS] });
    const loadPonyfill = vi.fn(async () => ponyfill);

    const detector = await createDetector({ native, loadPonyfill });

    expect(detector.source).toBe('wasm');
    expect(loadPonyfill).toHaveBeenCalledOnce();
  });

  test('çözümleyiciye yalnızca desteklediğimiz biçimler verilir', async () => {
    const native = fakeDetector({ supportedFormats: [...SCANNER_FORMATS] });

    await createDetector({ native });

    expect(native.lastFormats).toEqual([...SCANNER_FORMATS]);
  });

  test('okunan kodları ham değer ve biçimle döndürür', async () => {
    const native = fakeDetector({
      supportedFormats: [...SCANNER_FORMATS],
      results: [
        { rawValue: 'ENV-1001', format: 'qr_code' },
        { rawValue: '4006381333931', format: 'ean_13' },
      ],
    });

    const detector = await createDetector({ native });
    const codes = await detector.detect({} as ImageBitmapSource);

    expect(codes).toEqual([
      { rawValue: 'ENV-1001', format: 'qr_code' },
      { rawValue: '4006381333931', format: 'ean_13' },
    ]);
  });

  test('kod bulunamazsa boş liste döner', async () => {
    const native = fakeDetector({ supportedFormats: [...SCANNER_FORMATS], results: [] });

    const detector = await createDetector({ native });

    expect(await detector.detect({} as ImageBitmapSource)).toEqual([]);
  });

  test('boş değerli sonuçları süzer', async () => {
    // ZXing, kod bulunmayan görüntülerde boş değerli bir sonuç döndürebiliyor.
    const native = fakeDetector({
      supportedFormats: [...SCANNER_FORMATS],
      results: [
        { rawValue: '', format: 'unknown' },
        { rawValue: '   ', format: 'unknown' },
        { rawValue: 'ENV-1001', format: 'qr_code' },
      ],
    });

    const detector = await createDetector({ native });

    expect(await detector.detect({} as ImageBitmapSource)).toEqual([
      { rawValue: 'ENV-1001', format: 'qr_code' },
    ]);
  });
});
