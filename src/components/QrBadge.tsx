/**
 * Hazır üretilmiş karekod SVG'sini sayfaya yerleştirir.
 *
 * SVG işaretlemesi `dangerouslySetInnerHTML` ile gömülüyor. Bu bilinçli: SVG
 * `src/lib/qr.ts` içinde `qrcode` paketi tarafından üretiliyor ve yalnızca yol
 * (`path`) verisi içeriyor; karekodun taşıdığı metin çıktıya metin olarak
 * girmiyor (src/lib/qr.test.ts bunu doğruluyor). Yani kullanıcı verisinin
 * işaretlemeye sızacağı bir yol yok.
 *
 * Alternatif olarak SVG'yi JSX ile kendimiz kurabilirdik, ama o zaman modül
 * matrisini yol verisine çevirme işini de biz yazmış olurduk: okunamayan etiket
 * basmaya yol açabilecek, kütüphanenin zaten çözdüğü bir iş.
 *
 * Bileşen istemci bileşenlerinin içinde de kullanılabilsin diye `qrcode` paketini
 * içe aktarmıyor; SVG'yi hazır alıyor.
 */
export default function QrBadge({
  svg,
  label,
  className = '',
}: {
  /** src/lib/qr.ts tarafından üretilmiş SVG işaretlemesi. */
  svg: string;
  /** Ekran okuyucuya okunacak açıklama. */
  label: string;
  className?: string;
}) {
  return (
    /*
      SVG, src/lib/qr.ts içinde `qrcode` paketi tarafından üretiliyor ve yalnızca
      yol (path) verisi içeriyor; karekodun taşıdığı metin çıktıya METİN olarak
      girmiyor. src/lib/qr.test.ts bunu doğruluyor (<script, <text ve alan adı
      aranıyor), yani kullanıcı verisinin işaretlemeye sızacağı bir yol yok.
    */
    <span
      role="img"
      aria-label={label}
      className={`block [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: içerik kullanıcı verisi değil, qrcode paketinin ürettiği yol verisi (bkz. üstteki not ve src/lib/qr.test.ts)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
