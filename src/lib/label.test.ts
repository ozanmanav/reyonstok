import { describe, expect, test } from 'vitest';
import {
  buildLabelPayload,
  classifySiteUrl,
  isLocalSiteUrl,
  LABEL_BATCH_LIMIT,
  LABEL_FORMAT_LABELS,
  LABEL_FORMATS,
  resolveSiteUrl,
  siteUrlFromEnv,
  siteUrlWarning,
} from './label';
import { normalizeScan } from './scan-code';

/**
 * Etiket basımının kritik noktası: karekodun içine ne yazıldığı.
 *
 * Yanlış adresle basılmış bir etiket sessizce bozuktur; hata ancak biri
 * telefonuyla okutmaya çalıştığında ortaya çıkar ve o noktada etiketler çoktan
 * raflara yapıştırılmıştır. Bu yüzden adres çözümlemesi ve uyarı eşikleri tek tek
 * test ediliyor.
 */

describe('resolveSiteUrl', () => {
  test('boşlukları kırpar', () => {
    expect(resolveSiteUrl('  https://reyonstok.vercel.app  ')).toBe(
      'https://reyonstok.vercel.app'
    );
  });

  test('sondaki eğik çizgileri atar', () => {
    // Kullanıcı panele adresi eğik çizgiyle girdiğinde çift eğik çizgili
    // karekod adresi (".../scan" yerine "...//scan") üretilmemeli.
    expect(resolveSiteUrl('https://reyonstok.vercel.app/')).toBe(
      'https://reyonstok.vercel.app'
    );
    expect(resolveSiteUrl('https://reyonstok.vercel.app///')).toBe(
      'https://reyonstok.vercel.app'
    );
  });

  test('yol içeren adresin sonundaki eğik çizgiyi atar, yolu korur', () => {
    expect(resolveSiteUrl('https://magaza.com/reyon/')).toBe('https://magaza.com/reyon');
  });

  test('tanımsız ve boş değerler boş dize olur', () => {
    expect(resolveSiteUrl(undefined)).toBe('');
    expect(resolveSiteUrl(null)).toBe('');
    expect(resolveSiteUrl('')).toBe('');
    expect(resolveSiteUrl('   ')).toBe('');
  });

  test('metin olmayan değerlerde çökmez', () => {
    expect(resolveSiteUrl(42 as unknown as string)).toBe('');
  });
});

describe('siteUrlFromEnv', () => {
  test('açık tanımlanan adres önceliklidir', () => {
    expect(
      siteUrlFromEnv({
        NEXT_PUBLIC_SITE_URL: 'https://magaza.com/',
        VERCEL_PROJECT_PRODUCTION_URL: 'reyonstok.vercel.app',
      })
    ).toBe('https://magaza.com');
  });

  test('adres yoksa Vercel üretim adresine düşer ve protokol ekler', () => {
    expect(
      siteUrlFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: 'reyonstok.vercel.app' })
    ).toBe('https://reyonstok.vercel.app');
  });

  test('Vercel adresi protokollü gelirse iki kez eklenmez', () => {
    expect(
      siteUrlFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: 'https://reyonstok.vercel.app' })
    ).toBe('https://reyonstok.vercel.app');
  });

  test('hiçbir değişken yoksa boş dize döner', () => {
    expect(siteUrlFromEnv({})).toBe('');
    expect(siteUrlFromEnv({ NEXT_PUBLIC_SITE_URL: '  ' })).toBe('');
  });
});

describe('classifySiteUrl', () => {
  test('gerçek adresler public sayılır', () => {
    expect(classifySiteUrl('https://reyonstok.vercel.app')).toBe('public');
    expect(classifySiteUrl('http://192.168.1.40:3000')).toBe('public');
  });

  test('yerel adresler local sayılır', () => {
    expect(classifySiteUrl('http://localhost:3000')).toBe('local');
    expect(classifySiteUrl('http://127.0.0.1:3000')).toBe('local');
    expect(classifySiteUrl('http://0.0.0.0:3000')).toBe('local');
    expect(classifySiteUrl('http://macbook.local:3000')).toBe('local');
  });

  test('IPv6 yerel adresi de yakalanır', () => {
    // `new URL(...).hostname` IPv6'yı köşeli parantezle veriyor ("[::1]");
    // parantezler soyulmazsa bu adres gerçek bir alan adı sanılır.
    expect(classifySiteUrl('http://[::1]:3000')).toBe('local');
  });

  test('büyük harfli ana bilgisayar adı da yerel sayılır', () => {
    expect(classifySiteUrl('http://LOCALHOST:3000')).toBe('local');
  });

  test('protokolsüz veya bozuk adres invalid olur', () => {
    expect(classifySiteUrl('reyonstok.vercel.app')).toBe('invalid');
    expect(classifySiteUrl('https://')).toBe('invalid');
    expect(classifySiteUrl('ftp://magaza.com')).toBe('invalid');
  });

  test('boş adres missing olur', () => {
    expect(classifySiteUrl('')).toBe('missing');
  });
});

describe('isLocalSiteUrl', () => {
  test('yalnızca erişilebilir adreslerde false döner', () => {
    expect(isLocalSiteUrl('https://reyonstok.vercel.app')).toBe(false);
  });

  test('kullanılamaz adreslerin hepsinde true döner', () => {
    expect(isLocalSiteUrl('')).toBe(true);
    expect(isLocalSiteUrl('http://localhost:3000')).toBe(true);
    expect(isLocalSiteUrl('reyonstok.vercel.app')).toBe(true);
  });
});

describe('siteUrlWarning', () => {
  test('gerçek adreste uyarı yok', () => {
    expect(siteUrlWarning('https://reyonstok.vercel.app')).toBeNull();
  });

  test('adres tanımsızsa ortam değişkeninin adı söylenir', () => {
    const warning = siteUrlWarning('');

    expect(warning).toContain('NEXT_PUBLIC_SITE_URL');
  });

  test('yerel adreste uyarı adresin kendisini gösterir', () => {
    const warning = siteUrlWarning('http://localhost:3000');

    expect(warning).toContain('http://localhost:3000');
    expect(warning).toContain('yeniden basmanız');
  });

  test('bozuk adreste düzeltme önerilir', () => {
    const warning = siteUrlWarning('reyonstok.vercel.app');

    expect(warning).toContain('reyonstok.vercel.app');
    expect(warning).toContain('https://');
  });
});

describe('buildLabelPayload', () => {
  test('gerçek adres varsa tarama bağlantısı gömülür', () => {
    expect(buildLabelPayload('ENV-1001', 'https://reyonstok.vercel.app')).toBe(
      'https://reyonstok.vercel.app/scan?code=ENV-1001'
    );
  });

  test('yerel adres de gömülür', () => {
    // Deneme baskısının yayındaki davranışla aynı olması için.
    expect(buildLabelPayload('ENV-1001', 'http://localhost:3000')).toBe(
      'http://localhost:3000/scan?code=ENV-1001'
    );
  });

  test('adres yoksa düz ürün kodu yazılır', () => {
    // Göreli bir adres ("/scan?code=...") basılsaydı ne kamera uygulaması ne de
    // uygulama içindeki tarayıcı bunu ürün koduna çözebilirdi.
    expect(buildLabelPayload('ENV-1001', '')).toBe('ENV-1001');
  });

  test('bozuk adreste düz ürün kodu yazılır', () => {
    expect(buildLabelPayload('ENV-1001', 'reyonstok.vercel.app')).toBe('ENV-1001');
  });

  test('basılan değer tarayıcı tarafından aynı ürün koduna çözülür', () => {
    // Etiket basımı ile tarama arasındaki sözleşme: hangi yolla basılmış olursa
    // olsun okunan değer aynı ürüne gitmeli.
    for (const siteUrl of ['https://reyonstok.vercel.app', 'http://localhost:3000', '']) {
      const payload = buildLabelPayload('ENV-1042', siteUrl);

      expect(normalizeScan(payload)).toMatchObject({ kind: 'qr', code: 'ENV-1042' });
    }
  });

  test('küçük harfli kod da doğru çözülür', () => {
    const payload = buildLabelPayload('env-1042', 'https://reyonstok.vercel.app');

    expect(normalizeScan(payload).code).toBe('ENV-1042');
  });
});

describe('etiket biçimleri', () => {
  test('her biçimin Türkçe adı var', () => {
    for (const format of LABEL_FORMATS) {
      expect(LABEL_FORMAT_LABELS[format]).toBeTruthy();
    }
  });

  test('parti sınırı bir A4 sayfasından fazlasına izin verir', () => {
    // Tek reyonun etiketleri tek seferde çıkabilmeli.
    expect(LABEL_BATCH_LIMIT).toBeGreaterThan(21);
  });
});
