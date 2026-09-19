/**
 * Barkod çözümleyici katmanı.
 *
 * İki uygulama var ve hangisinin kullanılacağı tarayıcıya göre seçiliyor:
 *
 *  - Android Chrome'da `BarcodeDetector` yerleşik geliyor. Yerel (native) uygulama
 *    daha hızlı ve pil dostu, ama desteklediği biçimler cihaza göre değişiyor.
 *  - iOS Safari'de böyle bir API yok. Bu durumda `barcode-detector` paketinin
 *    ZXing WebAssembly tabanlı ponyfill'i devreye giriyor. WASM dosyası yaklaşık
 *    1 MB olduğu için dinamik içe aktarma ile yükleniyor; ana paket şişmiyor.
 *
 * Yerel uygulama var ama ihtiyacımız olan biçimleri desteklemiyorsa da ponyfill'e
 * düşüyoruz: reyon karekodunu okuyup ürün barkodunu okuyamayan bir tarayıcı
 * mağazada yarım çözüm olurdu.
 */

/**
 * Mağazada karşılaşılan biçimler.
 *
 * `qr_code` bizim ürettiğimiz reyon etiketleri için; diğerleri perakende ürün
 * barkodları: EAN-13 (Avrupa/Türkiye), EAN-8 (küçük ambalaj), UPC-A ve UPC-E
 * (ithal ürünler), Code-128 (depo/iç etiketler).
 */
export const SCANNER_FORMATS = [
  'qr_code',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
] as const;

/**
 * Ponyfill'e düşmeden yerel uygulamayı kabul etmek için gereken en az biçim
 * kümesi. Karekod ve EAN-13 olmadan uygulama işe yaramaz.
 */
const REQUIRED_FORMATS = ['qr_code', 'ean_13'] as const;

/** Hangi uygulamanın kullanıldığı; arayüzde ve hata ayıklamada gösterilir. */
export type DetectorSource = 'native' | 'wasm';

/** Çözümlenen tek bir kod. */
export interface DetectedCode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorLike {
  detect(image: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}

/**
 * Hem yerel `BarcodeDetector` hem ponyfill bu şekle uyuyor. Testlerde yerine
 * sahte uygulama geçirilebilsin diye ayrı tip olarak tanımlandı.
 */
export interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<readonly string[]>;
}

export interface ScannerDetector {
  source: DetectorSource;
  /** Verilen görüntü kaynağında bulunan kodları döndürür. */
  detect(image: ImageBitmapSource): Promise<DetectedCode[]>;
}

export interface CreateDetectorDeps {
  /** Tarayıcıdaki yerleşik uygulama; yoksa undefined. */
  native?: BarcodeDetectorConstructor;
  /** WASM tabanlı yedek uygulamayı yükler. */
  loadPonyfill?: () => Promise<BarcodeDetectorConstructor>;
}

/**
 * WASM dosyasının kendi alan adımızdan yükleneceği yol.
 *
 * `barcode-detector` varsayılan olarak dosyayı jsDelivr CDN'inden indiriyor.
 * iOS Safari'de tarama tamamen bu dosyaya bağlı olduğu için mağaza ağının
 * CDN'e erişimine güvenmek istemiyoruz; dosya `npm run sync:wasm` ile
 * `public/zxing/` altına kopyalanıp buradan servis ediliyor.
 */
const LOCAL_WASM_PATH = '/zxing/';

/**
 * Yerel uygulamanın ihtiyacımız olan biçimleri destekleyip desteklemediğini
 * söyler.
 *
 * `getSupportedFormats` yoksa (eski uygulamalar) güvenli tarafta kalıp
 * desteklemiyor sayıyoruz; yanlış biçim listesiyle sessizce okunamayan
 * barkodlar, yavaş ama çalışan bir çözümden kötüdür.
 */
export async function nativeSupportsRequiredFormats(
  native: BarcodeDetectorConstructor | undefined
): Promise<boolean> {
  if (!native?.getSupportedFormats) {
    return false;
  }

  try {
    const supported = await native.getSupportedFormats();

    return REQUIRED_FORMATS.every((format) => supported.includes(format));
  } catch {
    // Biçim listesi alınamıyorsa yerel uygulamaya güvenmiyoruz.
    return false;
  }
}

/**
 * Çalışan bir çözümleyici oluşturur.
 *
 * Yalnızca tarayıcıda çağrılmalı; sunucuda `BarcodeDetector` ve kamera yok.
 */
export async function createDetector(deps: CreateDetectorDeps = {}): Promise<ScannerDetector> {
  const native =
    deps.native ??
    (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;

  const loadPonyfill =
    deps.loadPonyfill ??
    (async () => {
      const ponyfillModule = await import('barcode-detector/ponyfill');

      // Tarayıcıda WASM dosyasını kendi sunucumuzdan yükle. Node ortamında
      // (testler) böyle bir yol bulunmadığı için paketin varsayılanı bırakılıyor.
      if (typeof document !== 'undefined') {
        ponyfillModule.setZXingModuleOverrides({
          locateFile: (fileName: string) => `${LOCAL_WASM_PATH}${fileName}`,
        });
      }

      return ponyfillModule.BarcodeDetector as unknown as BarcodeDetectorConstructor;
    });

  if (await nativeSupportsRequiredFormats(native)) {
    return buildDetector(native!, 'native');
  }

  const ponyfill = await loadPonyfill();

  return buildDetector(ponyfill, 'wasm');
}

function buildDetector(
  Constructor: BarcodeDetectorConstructor,
  source: DetectorSource
): ScannerDetector {
  // Biçim listesini daraltmak hem hızlandırıyor hem yanlış eşleşmeleri azaltıyor.
  const detector = new Constructor({ formats: [...SCANNER_FORMATS] });

  return {
    source,
    async detect(image) {
      const results = await detector.detect(image);

      return (
        results
          .map((result) => ({
            rawValue: result.rawValue,
            format: result.format,
          }))
          // ZXing kod bulunmayan görüntülerde de bazen boş değerli bir sonuç
          // döndürüyor (rawValue: '', format: 'unknown'). Süzülmezse tarayıcı
          // boş kod okumuş gibi davranıp sürekli "ürün bulunamadı" gösterirdi.
          .filter((result) => result.rawValue.trim() !== '')
      );
    },
  };
}
