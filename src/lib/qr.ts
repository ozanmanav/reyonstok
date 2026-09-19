import QRCode from 'qrcode';

/**
 * Karekod görselinin üretimi.
 *
 * Karekodlar SUNUCUDA SVG'ye çevrilip sayfaya gömülüyor. Nedeni basımın
 * güvenilirliği: tarayıcıda üretilseydi yazdırma penceresi JavaScript'in
 * bitmesini beklemek zorunda kalır, `<img>` ile getirilseydi etiket başına bir
 * HTTP isteği açılır ve yüklenmeden basılan boş kareler ortaya çıkabilirdi. SVG
 * olarak gömüldüğünde etiket, sayfanın geldiği anda basıma hazır ve yazıcı
 * çözünürlüğünde keskin oluyor.
 *
 * `qrcode` paketi yalnızca burada kullanılıyor; bu modülü hiçbir istemci bileşeni
 * içe aktarmadığı için paket tarayıcı paketine girmiyor.
 */

/**
 * Karekod kodlama ayarları.
 *
 * Hata düzeltme seviyesi 'Q' (%25 kurtarma): reyon etiketi tozlanıyor,
 * çiziliyor, üstüne başka bir etiket yapıştırılıyor. Tipik etiket adresi
 * uzunluğunda (~47 karakter) 'M' ile aynı modül sayısını (33x33) verdiği için bu
 * dayanıklılık bedava geliyor; karekod büyümüyor, baskı küçülmüyor.
 *
 * Sessiz bölge 2 modül: şartname 4 modül istiyor ama basılı etikette 4 modül
 * gözle görülür bir boşluk yaratıp karekodu küçültüyor. 2 modül, beyaz etiket
 * zemininin devamıyla birleşerek pratikte yeterli oluyor.
 *
 * Ayarlar dışa açık: okunabilirliği gerçek çözümleyiciyle sınayan test
 * (tests/scanner-wasm.test.ts) basılanın aynısını üretmek için bunları kullanıyor.
 */
export const QR_ENCODE_OPTIONS = {
  errorCorrectionLevel: 'Q',
  margin: 2,
} as const;

/**
 * Verilen metni karekod SVG'sine çevirir.
 *
 * Dönen SVG'de `width`/`height` yok, yalnızca `viewBox` var: etiket düzeni
 * boyutu CSS ile belirliyor, aynı karekod hem A4 hem termal etikette kullanılıyor.
 *
 * @param value Karekodun taşıyacağı metin (etiket adresi veya ürün kodu).
 */
export async function renderQrSvg(value: string): Promise<string> {
  return QRCode.toString(value, { type: 'svg', ...QR_ENCODE_OPTIONS });
}

/**
 * Bir grup metin için karekodları paralel üretir.
 *
 * @returns Anahtarı giriş metni olan SVG eşlemesi. Aynı metin iki kez geçse bile
 * tek kez üretilir.
 */
export async function renderQrSvgMap(values: string[]): Promise<Record<string, string>> {
  const distinct = [...new Set(values)];

  const entries = await Promise.all(
    distinct.map(async (value) => [value, await renderQrSvg(value)] as const)
  );

  return Object.fromEntries(entries);
}
