/**
 * Reyon etiketi yardımcıları.
 *
 * Etiketteki karekodun içine uygulamanın genel adresi gömülüyor. Bu adres
 * yanlışsa basılan etiketler işe yaramaz: telefonun kamera uygulaması karekodu
 * okuduğunda açılamayan bir sayfaya gider. Yüzlerce etiket basıldıktan sonra
 * fark edilmesi pahalı olduğu için adres burada denetleniyor ve arayüzde
 * kullanıcıya gösteriliyor.
 */

import { buildScanUrl } from './scan-code';

/** Etiket düzenleri. */
export const LABEL_FORMATS = ['a4', 'thermal'] as const;

export type LabelFormat = (typeof LABEL_FORMATS)[number];

export const LABEL_FORMAT_LABELS: Record<LabelFormat, string> = {
  a4: 'A4 sayfa (3 sütun)',
  thermal: 'Termal etiket (58x40 mm, ayrı sayfa)',
};

/**
 * Tek seferde hazırlanacak en fazla etiket sayısı.
 *
 * Her karekod sunucuda SVG'ye çevrilip sayfaya gömülüyor (etiket başına ~2 KB).
 * Sınır olmadan 500 ürünlük bir mağazada sayfa megabaytlara çıkıyor ve telefonda
 * açılmaz hale geliyor. Reyon filtresiyle parça parça basmak zaten mağazadaki
 * doğal iş akışı: personel bir reyonun etiketlerini alıp o rafa gidiyor.
 */
export const LABEL_BATCH_LIMIT = 120;

/** Adresin etiket basımına uygunluğu. */
export type SiteUrlStatus =
  /** Ortam değişkeni tanımlı değil. */
  | 'missing'
  /** Adres çözümlenemiyor (örn. protokol yazılmamış). */
  | 'invalid'
  /** Yalnızca geliştirme makinesinden erişilebilir. */
  | 'local'
  /** Mağaza telefonundan erişilebilir gerçek adres. */
  | 'public';

/**
 * Ortam değişkeninden gelen adresi temizler.
 *
 * Sondaki eğik çizgi ve boşluklar atılır; tanımsızsa boş dize döner, böylece
 * çağıran taraf eksikliği anlayıp uyarabilir.
 */
export function resolveSiteUrl(raw: string | undefined | null): string {
  if (typeof raw !== 'string') {
    return '';
  }

  return raw.trim().replace(/\/+$/, '');
}

/**
 * Uygulamanın genel adresini ortamdan belirler.
 *
 * `NEXT_PUBLIC_SITE_URL` önceliklidir. Tanımlı değilse Vercel'in verdiği kalıcı
 * üretim adresine düşülür; dağıtıma özgü `VERCEL_URL` her yayında değiştiği ve
 * basılmış etiketleri geçersiz kılacağı için bilinçli olarak kullanılmıyor.
 *
 * Ortam nesnesi parametre olarak alınıyor: `process.env`'i içeride okumak
 * fonksiyonu test edilemez hale getirirdi.
 */
export function siteUrlFromEnv(env: Record<string, string | undefined>): string {
  const explicit = resolveSiteUrl(env.NEXT_PUBLIC_SITE_URL);
  if (explicit !== '') {
    return explicit;
  }

  const production = resolveSiteUrl(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (production === '') {
    return '';
  }

  // Vercel bu değişkeni protokolsüz veriyor (reyonstok.vercel.app).
  return /^https?:\/\//i.test(production) ? production : `https://${production}`;
}

/** Adresi etiket basımı açısından sınıflandırır. */
export function classifySiteUrl(url: string): SiteUrlStatus {
  if (url === '') {
    return 'missing';
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'invalid';
  }

  // IPv6 adreslerinde `hostname` köşeli parantezle geliyor: "[::1]".
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost');

  return isLocal ? 'local' : 'public';
}

/**
 * Adresin yalnızca bu bilgisayardan erişilebilir olup olmadığını söyler.
 *
 * Mağaza telefonu `localhost` adresine ulaşamaz; böyle bir adresle basılan
 * etiketler okunduğunda hiçbir şey açılmaz. Çözülemeyen ve tanımsız adresler de
 * güvenli sayılmaz.
 */
export function isLocalSiteUrl(url: string): boolean {
  return classifySiteUrl(url) !== 'public';
}

/** Etiket sayfasında adresin durumu hakkında gösterilecek uyarı. */
export function siteUrlWarning(url: string): string | null {
  switch (classifySiteUrl(url)) {
    case 'missing':
      return 'Uygulama adresi tanımlı değil (NEXT_PUBLIC_SITE_URL). Karekodlar yalnızca ürün kodunu taşıyacak; uygulama içinden okutulunca çalışır, telefonun kamera uygulamasıyla okutulunca sayfa açılmaz.';

    case 'invalid':
      return `Uygulama adresi (NEXT_PUBLIC_SITE_URL) çözümlenemedi: "${url}". Karekodlar yalnızca ürün kodunu taşıyacak. Adresi "https://" ile başlayacak şekilde yazın.`;

    case 'local':
      return `Karekodlar ${url} adresini gösteriyor. Bu adrese mağaza telefonundan ulaşılamaz; yayına aldıktan sonra etiketleri yeniden basmanız gerekir.`;

    case 'public':
      return null;
  }
}

/**
 * Karekodun içine yazılacak değeri üretir.
 *
 * Kullanılabilir bir genel adres varsa tarama sayfasının adresi gömülür; böylece
 * telefonun kendi kamera uygulaması karekodu okuduğunda doğrudan ürün açılır.
 * Adres yoksa ya da bozuksa düz ürün kodu yazılır: uygulama içindeki tarayıcı
 * bunu okuyabilir, açılamayan bir bağlantı basmaktan iyidir.
 */
export function buildLabelPayload(code: string, siteUrl: string): string {
  const status = classifySiteUrl(siteUrl);

  // 'local' adres de gömülüyor: geliştirme sırasında basılan deneme etiketleri
  // uygulama içinden okutulunca çalışsın, yayındaki davranışla aynı olsun.
  return status === 'missing' || status === 'invalid' ? code : buildScanUrl(code, siteUrl);
}
