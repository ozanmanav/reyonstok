/**
 * Karekod ve barkod değerlerinin çözümlenmesi.
 *
 * Mağazada iki tür kod okutuluyor:
 *  - Bizim ürettiğimiz ürün karekodu (`ENV-1001`). Reyon etiketlerine basılır ve
 *    telefonun kendi kamera uygulaması da okuyabilsin diye karekodun içine
 *    `https://<adres>/scan?code=ENV-1001` biçiminde bir adres gömülür.
 *  - Üreticinin ürün üstündeki barkodu (çoğunlukla EAN-13).
 *
 * Bu modül tarayıcıdan gelen ham metni tek bir sözleşmeye indirger; ağ, veritabanı
 * veya tarayıcı API'si kullanmaz, bu yüzden tamamen test edilebilir.
 */

/** Ürün kodlarının sabit ön eki. */
export const PRODUCT_CODE_PREFIX = 'ENV-';

/** Hiç ürün yokken verilen ilk ürün kodu. */
export const PRODUCT_CODE_START = 'ENV-1001';

const PRODUCT_CODE_PATTERN = /^env-(\d+)$/i;
const THIRTEEN_DIGITS = /^\d{13}$/;
const TWELVE_DIGITS = /^\d{12}$/;

export type ScanKind =
  /** Bizim ürettiğimiz ürün karekodu, `products.code` ile aranır. */
  | 'qr'
  /** Kontrol hanesi doğrulanmış EAN-13 barkodu, `products.barcode` ile aranır. */
  | 'ean13'
  /**
   * Tanınmayan biçim: EAN-8, Code-128 veya elle yazılmış hatalı barkod.
   * `code` boş değilse yine aranabilir; boşsa kullanılabilir bir değer yok.
   */
  | 'unknown';

export interface ScanResult {
  kind: ScanKind;
  /** Aramada kullanılacak değer. Boş dize, okunan şeyin kullanılamaz olduğunu gösterir. */
  code: string;
  /** Tarayıcıdan gelen ham metin; hata ayıklama ve kullanıcıya gösterim için saklanır. */
  raw: string;
}

/**
 * EAN-13 kontrol hanesini hesaplar.
 *
 * Soldan sağa tek sıradaki haneler 1, çift sıradaki haneler 3 ile çarpılır;
 * toplamı 10'un bir sonraki katına tamamlayan sayı kontrol hanesidir.
 *
 * @param first12 Barkodun kontrol hanesi hariç ilk 12 hanesi.
 * @throws {TypeError} Girdi tam olarak 12 rakam değilse.
 */
export function ean13CheckDigit(first12: string): number {
  if (!TWELVE_DIGITS.test(first12)) {
    throw new TypeError(
      `EAN-13 kontrol hanesi için 12 rakam gerekir, gelen değer: "${first12}"`
    );
  }

  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = first12.charCodeAt(index) - 48;
    // index 0 soldan birinci hane (tek sıra) olduğu için çift index'ler 1,
    // tek index'ler 3 ile çarpılır.
    sum += index % 2 === 0 ? digit : digit * 3;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * Değerin kontrol hanesi tutan, 13 haneli bir EAN-13 barkodu olup olmadığını söyler.
 * Hatalı okuma ve elle giriş hatalarını yakalamak için kullanılır.
 */
export function isValidEan13(value: string): boolean {
  if (!THIRTEEN_DIGITS.test(value)) {
    return false;
  }

  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

/**
 * Tarayıcıdan gelen ham metni arama için kullanılabilir tek bir sonuca çevirir.
 *
 * Sırayla: boşluk kırpılır, adres biçimindeki karekod yükünden `code` parametresi
 * ayıklanır, sonuç ürün kodu / EAN-13 / diğer olarak sınıflandırılır.
 */
export function normalizeScan(raw: string | null | undefined): ScanResult {
  const original = typeof raw === 'string' ? raw : '';
  const trimmed = original.trim();

  if (trimmed === '') {
    return { kind: 'unknown', code: '', raw: original };
  }

  const fromUrl = extractCodeFromUrl(trimmed);
  // `null` => adres değil, düz değer olarak ele al.
  const value = fromUrl === null ? trimmed : fromUrl;

  if (value === '') {
    // Adres okundu ama içinde `code` parametresi yok: kullanılabilir kod çıkmadı.
    return { kind: 'unknown', code: '', raw: original };
  }

  if (PRODUCT_CODE_PATTERN.test(value)) {
    return { kind: 'qr', code: value.toUpperCase(), raw: original };
  }

  if (THIRTEEN_DIGITS.test(value)) {
    // Kontrol hanesi tutmuyorsa büyük olasılıkla hatalı okuma ya da yazım hatası;
    // değeri koruyup doğrulanmadığını belirtiyoruz.
    return {
      kind: isValidEan13(value) ? 'ean13' : 'unknown',
      code: value,
      raw: original,
    };
  }

  // EAN-8, Code-128 ve benzeri biçimler: doğrulayamıyoruz ama barkod alanında
  // aranabilirler, bu yüzden değeri olduğu gibi (harf büyüklüğünü bozmadan) veriyoruz.
  return { kind: 'unknown', code: value, raw: original };
}

/**
 * Sıradaki ürün kodunu üretir. Hane sayısı sıfırla doldurulmuşsa dolgu korunur
 * (`ENV-0007` -> `ENV-0008`). Son kod okunamazsa başlangıç koduna dönülür.
 */
export function nextProductCode(lastCode?: string | null): string {
  if (typeof lastCode !== 'string') {
    return PRODUCT_CODE_START;
  }

  const match = PRODUCT_CODE_PATTERN.exec(lastCode.trim());
  if (match === null) {
    return PRODUCT_CODE_START;
  }

  const digits = match[1];
  const next = String(Number(digits) + 1);

  return `${PRODUCT_CODE_PREFIX}${next.padStart(digits.length, '0')}`;
}

/**
 * Reyon etiketindeki karekodun içine gömülecek adresi üretir. Telefonun kendi
 * kamera uygulaması bu karekodu okuduğunda doğrudan ürünün tarama sayfası açılır.
 */
export function buildScanUrl(code: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, '');

  return `${base}/scan?code=${encodeURIComponent(code)}`;
}

/**
 * Değeri adres olarak çözmeyi dener.
 *
 * @returns `null` adres olmadığını, boş dize adres olduğunu ama `code`
 * parametresi taşımadığını, diğer değerler ayıklanan kodu gösterir.
 */
function extractCodeFromUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }

  try {
    return (new URL(value).searchParams.get('code') ?? '').trim();
  } catch {
    // Bozuk adres: düz metin gibi değerlendirilsin.
    return null;
  }
}
