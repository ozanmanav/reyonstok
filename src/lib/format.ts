/**
 * Ekranda gösterilecek değerlerin biçimlendirilmesi.
 *
 * Saat dilimi ve yerel ayar bilinçli olarak sabitlendi. İkisi de ortama
 * bırakılırsa sunucuda ve tarayıcıda farklı metin üretiliyor; Next.js bunu
 * hidrasyon uyuşmazlığı olarak bildiriyor. Ayrıca mağaza Türkiye'de olduğu için
 * personelin UTC saat görmesi doğru olmaz.
 */

const LOCALE = 'tr-TR';
const TIME_ZONE = 'Europe/Istanbul';

const currencyFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const integerFormatter = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

/** Para tutarı: "290,00" (simge çağıran tarafta eklenir). */
export function formatPrice(value: number): string {
  return currencyFormatter.format(value);
}

/** Para tutarı, simgeyle: "290,00 ₺". */
export function formatCurrency(value: number): string {
  return `${currencyFormatter.format(value)} ₺`;
}

/** Büyük toplamlar için kuruşsuz gösterim: "12.950 ₺". */
export function formatCurrencyCompact(value: number): string {
  return `${compactCurrencyFormatter.format(value)} ₺`;
}

/** Adet gibi tam sayılar: "1.250". */
export function formatQuantity(value: number): string {
  return integerFormatter.format(value);
}

/** Tarih ve saat: "18.09.2026 21:12". */
export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

/** Yalnızca saat: "21:12". Aynı güne ait hareketlerde yeterli. */
export function formatTime(value: string): string {
  return timeFormatter.format(new Date(value));
}

/** Kısa tarih: "18.09.26". Etiket üzerinde yer kazandırır. */
export function formatShortDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

/** Değişim miktarı, işaretiyle: "+3" / "-1" / "0". */
export function formatChange(value: number): string {
  if (value > 0) {
    return `+${integerFormatter.format(value)}`;
  }

  return integerFormatter.format(value);
}
