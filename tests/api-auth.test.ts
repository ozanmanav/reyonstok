// @vitest-environment node
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { parseCsv } from '@/lib/csv';
import { detectColumnMapping, missingRequiredFields, parseImportRows } from '@/lib/product-import';
import {
  createAdminClient,
  createSessionCookieHeader,
  createTestUser,
  deleteProducts,
  deleteTestUser,
  type TestUser,
  uniqueProductCode,
} from './helpers/supabase';

/**
 * Oturum açılmış isteklerin uçtan uca doğrulanması.
 *
 * Çerezler `@supabase/ssr`'ın kendi serileştirmesiyle üretiliyor, yani
 * uygulamanın gerçekten alacağı çerezlerle test ediyoruz. Böylece rol bazlı
 * yetkilerin hem uygulama katmanında (requireRole) hem veritabanında (RLS)
 * çalıştığı, gerçek HTTP istekleriyle gösteriliyor.
 *
 * Sunucu tests/global-setup.ts tarafından bir kez başlatılıyor.
 */

const BASE_URL = inject('baseUrl');

let adminUser: TestUser;
let staffUser: TestUser;
let viewerUser: TestUser;
let adminCookie: string;
let staffCookie: string;
let viewerCookie: string;

const admin = createAdminClient();
const createdProductIds: number[] = [];

/** Oturumlu istek atar. */
function request(path: string, cookie: string, init: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', cookie, ...init.headers },
  });
}

async function createProduct(overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('products')
    .insert({
      code: uniqueProductCode(),
      name: 'HTTP Test Ürünü',
      shelf_location: 'HTTP Reyonu',
      sale_price: 50,
      stock_quantity: 10,
      ...overrides,
    })
    .select('id, code')
    .single();

  if (error || !data) {
    throw new Error(`Test ürünü oluşturulamadı: ${error?.message}`);
  }

  const product = data as { id: number; code: string };
  createdProductIds.push(product.id);

  return product;
}

beforeAll(async () => {
  [adminUser, staffUser, viewerUser] = await Promise.all([
    createTestUser('admin'),
    createTestUser('staff'),
    createTestUser('viewer'),
  ]);

  [adminCookie, staffCookie, viewerCookie] = await Promise.all([
    createSessionCookieHeader(adminUser.email, adminUser.password),
    createSessionCookieHeader(staffUser.email, staffUser.password),
    createSessionCookieHeader(viewerUser.email, viewerUser.password),
  ]);
}, 90_000);

afterAll(async () => {
  await deleteProducts(createdProductIds);
  await Promise.all(
    [adminUser, staffUser, viewerUser].filter(Boolean).map((user) => deleteTestUser(user)),
  );
});

describe('ana panel', () => {
  test('özet kartları ve bölümler görünür', async () => {
    const response = await request('/', staffCookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Reyon karekod ve stok yönetimi');
    expect(html).toContain('Kayıtlı ürün');
    expect(html).toContain('Toplam stok');
    expect(html).toContain('Envanter değeri');
    expect(html).toContain('Kritik stok');
    expect(html).toContain('Reyonlar');
    expect(html).toContain('Son stok ve fiyat hareketleri');
  });

  test('tarama ve etiket basma bağlantıları en üstte', async () => {
    const html = await (await request('/', staffCookie)).text();

    expect(html).toContain('Karekod tara');
    expect(html).toContain('/print-labels');
  });

  test('kritik stok kartı filtreli listeye bağlanır', async () => {
    const html = await (await request('/', staffCookie)).text();

    expect(html).toContain('/products?lowStock=true');
  });

  test('reyon listesi filtreli ürün listesine bağlanır', async () => {
    const shelf = `Panel Reyonu ${Date.now()}`;
    await createProduct({ name: 'Panel Ürünü', shelf_location: shelf });

    const html = await (await request('/', staffCookie)).text();

    expect(html).toContain(shelf);
    expect(html).toContain(`/products?shelf=${encodeURIComponent(shelf)}`);
  });

  test('son hareketler ürün adı ve kullanıcıyla listelenir', async () => {
    const product = await createProduct({
      name: 'Panelde Görünecek Hareket',
      stock_quantity: 5,
      shelf_location: 'Panel Hareket Reyonu',
    });

    await request(`/api/products/${product.id}/adjust`, staffCookie, {
      method: 'POST',
      body: JSON.stringify({ stockDelta: -1 }),
    });

    const html = await (await request('/', staffCookie)).text();

    expect(html).toContain('Panelde Görünecek Hareket');
    expect(html).toContain('Test staff');
    expect(html).toContain('-1');
  });

  test('envanter değeri Türkçe biçimde gösterilir', async () => {
    const html = await (await request('/', staffCookie)).text();

    // Binlik ayırıcı nokta ve para simgesi.
    expect(html).toMatch(/\d{1,3}(\.\d{3})*\s₺/);
  });
});

describe('oturumlu sayfa erişimi', () => {
  test('giriş yapmış kullanıcı ana sayfayı görür, yönlendirilmez', async () => {
    const response = await request('/', staffCookie);

    expect(response.status).toBe(200);
  });

  test('gezinme çubuğunda kullanıcının rolü görünür', async () => {
    const html = await (await request('/', staffCookie)).text();

    expect(html).toContain('Personel');
    expect(html).toContain('Çıkış');
  });

  test('giriş yapmış kullanıcı giriş sayfasından ana sayfaya yönlendirilir', async () => {
    const response = await request('/login', staffCookie);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toMatch(/\/$|\/\?/);
  });

  test('yönetici personel sayfasını görebilir', async () => {
    const response = await request('/admin/users', adminCookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Yeni personel ekle');
  });

  test('personel rolü yönetici sayfasında yetki uyarısı görür', async () => {
    const response = await request('/admin/users', staffCookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Bu sayfaya erişiminiz yok');
    expect(html).not.toContain('Yeni personel ekle');
  });

  test('gezinme çubuğu personel bağlantısını yalnızca yöneticiye gösterir', async () => {
    const adminHtml = await (await request('/', adminCookie)).text();
    const staffHtml = await (await request('/', staffCookie)).text();

    expect(adminHtml).toContain('/admin/users');
    expect(staffHtml).not.toContain('/admin/users');
  });
});

describe('tarama ekranı', () => {
  test('tarama sayfası açılır', async () => {
    const response = await request('/scan', staffCookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Karekod tara');
  });

  test('adresteki kod ile açıldığında kamera beklemeden kodu gösterir', async () => {
    // Telefonun kendi kamera uygulaması etiketi okuduğunda bu yolla geliyoruz.
    const html = await (await request('/scan?code=ENV-1001', staffCookie)).text();

    expect(html).toContain('ENV-1001');
    expect(html).toContain('Reyon karekodu');
  });

  test('etiket adresi biçimindeki kodu çözüp gösterir', async () => {
    const labelUrl = encodeURIComponent('https://reyonstok.vercel.app/scan?code=ENV-1042');
    const html = await (await request(`/scan?code=${labelUrl}`, staffCookie)).text();

    expect(html).toContain('ENV-1042');
  });

  test('barkod biçimi doğru etiketlenir', async () => {
    const html = await (await request('/scan?code=4006381333931', staffCookie)).text();

    expect(html).toContain('EAN-13 barkod');
  });

  test('kullanılamayan kod ile açıldığında sonuç kartı gösterilmez', async () => {
    const html = await (await request('/scan?code=%20%20', staffCookie)).text();

    expect(html).not.toContain('Okunan kod');
  });

  test('kayıtlı ürün sunucuda getirilip kartla birlikte gelir', async () => {
    // Etiket karekoduyla gelen personel ek istek beklemeden ürünü görmeli.
    const product = await createProduct({
      name: 'Sunucudan Gelen Ürün',
      sale_price: 149.9,
      stock_quantity: 6,
      shelf_location: 'Reyon Z - Raf 3',
    });

    const html = await (
      await request(`/scan?code=${encodeURIComponent(product.code)}`, staffCookie)
    ).text();

    expect(html).toContain('Sunucudan Gelen Ürün');
    expect(html).toContain('149,90 ₺');
    expect(html).toContain('Reyon Z - Raf 3');
    expect(html).toContain('Hızlı düzeltme');
    // Yükleniyor durumu görünmemeli: veri sunucuda hazırlandı.
    expect(html).not.toContain('Ürün bilgisi getiriliyor');
  });

  test('bulunamayan kodda yeni ürün yönlendirmesi gösterilir', async () => {
    const html = await (await request('/scan?code=ENV-98765432', staffCookie)).text();

    expect(html).toContain('Bu kodla kayıtlı ürün yok');
    expect(html).toContain('/products/new?code=ENV-98765432');
  });

  test('görüntüleyici rolünde düzeltme bölümü ve ürün ekleme bağlantısı yok', async () => {
    const product = await createProduct({ name: 'Salt Okunur Ürün' });

    const foundHtml = await (
      await request(`/scan?code=${encodeURIComponent(product.code)}`, viewerCookie)
    ).text();
    expect(foundHtml).toContain('Salt Okunur Ürün');
    expect(foundHtml).not.toContain('Hızlı düzeltme');
    expect(foundHtml).toContain('Yetkiniz görüntüleme ile sınırlı');

    const missingHtml = await (await request('/scan?code=ENV-98765432', viewerCookie)).text();
    expect(missingHtml).not.toContain('/products/new');
    expect(missingHtml).toContain('Ürün ekleme yetkiniz yok');
  });

  test('barkod okunduğunda yeni ürün bağlantısı barkod alanını doldurur', async () => {
    // 4006381333931 geçerli EAN-13 ama kayıtlı değil.
    const html = await (await request('/scan?code=4006381333931', staffCookie)).text();

    expect(html).toContain('/products/new?barcode=4006381333931');
  });
});

describe('ürün listesi', () => {
  test('liste ürünleri fiyat ve stokla gösterir', async () => {
    const product = await createProduct({
      name: 'Listede Görünen Ürün',
      sale_price: 77.5,
      stock_quantity: 4,
      shelf_location: 'Liste Reyonu',
    });

    const html = await (await request('/products', staffCookie)).text();

    expect(html).toContain('Listede Görünen Ürün');
    expect(html).toContain('77,50 ₺');
    expect(html).toContain(`/products/${product.id}/edit`);
  });

  test('reyon filtresi yalnızca o reyonu getirir', async () => {
    const shelf = `Filtre Reyonu ${Date.now()}`;
    await createProduct({ name: 'Filtreli Ürün', shelf_location: shelf });
    await createProduct({ name: 'Filtre Dışı Ürün', shelf_location: 'Başka Reyon' });

    const html = await (
      await request(`/products?shelf=${encodeURIComponent(shelf)}`, staffCookie)
    ).text();

    expect(html).toContain('Filtreli Ürün');
    expect(html).not.toContain('Filtre Dışı Ürün');
  });

  test('kritik stok filtresi eşiğin altındakileri getirir', async () => {
    const shelf = `Kritik Reyon ${Date.now()}`;
    await createProduct({
      name: 'Azalan Ürün',
      shelf_location: shelf,
      stock_quantity: 1,
      min_stock_alert: 5,
    });
    await createProduct({
      name: 'Bol Ürün',
      shelf_location: shelf,
      stock_quantity: 40,
      min_stock_alert: 5,
    });

    const html = await (
      await request(`/products?shelf=${encodeURIComponent(shelf)}&lowStock=true`, staffCookie)
    ).text();

    expect(html).toContain('Azalan Ürün');
    expect(html).not.toContain('Bol Ürün');
  });

  test('eşleşme yoksa bilgi mesajı gösterir', async () => {
    const html = await (
      await request('/products?search=kesinlikle-boyle-bir-urun-yok', staffCookie)
    ).text();

    expect(html).toContain('Bu filtrelere uyan ürün yok');
  });

  test('görüntüleyiciye ekleme ve yükleme bağlantıları gösterilmez', async () => {
    const staffHtml = await (await request('/products', staffCookie)).text();
    const viewerHtml = await (await request('/products', viewerCookie)).text();

    expect(staffHtml).toContain('/products/new');
    expect(staffHtml).toContain('/products/import');
    expect(viewerHtml).not.toContain('/products/new');
    expect(viewerHtml).not.toContain('/products/import');
    // CSV indirme okuma işlemi, herkese açık kalmalı.
    expect(viewerHtml).toContain('/api/products/export');
  });
});

describe('etiket basımı', () => {
  test('sayfa açılır, düzen seçimi ve yazdırma butonu gelir', async () => {
    const response = await request('/print-labels', staffCookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Etiket bas');
    expect(html).toContain('Etiket düzeni');
    expect(html).toContain('A4 sayfa (3 sütun)');
    expect(html).toContain('Yazdır');
  });

  test('her ürün için karekod SVG"si sayfaya gömülür', async () => {
    // Karekodlar sunucuda üretiliyor; tarayıcıda üretilse yazdırma penceresi
    // boş kareler basabilirdi. SVG'nin gerçekten HTML içinde geldiğini
    // doğruluyoruz.
    const shelf = `Etiket Reyonu ${Date.now()}`;
    await createProduct({ name: 'Etiketlenecek Bir', shelf_location: shelf });
    await createProduct({ name: 'Etiketlenecek İki', shelf_location: shelf });

    const html = await (
      await request(`/print-labels?shelf=${encodeURIComponent(shelf)}`, staffCookie)
    ).text();

    expect(html).toContain('Etiketlenecek Bir');
    expect(html).toContain('Etiketlenecek İki');

    // İki ürün, iki karekod.
    const svgCount = html.match(/<svg/g)?.length ?? 0;
    expect(svgCount).toBe(2);

    // Ölçeklenebilir olmalı: fiziksel boyutu baskı CSS'i veriyor.
    expect(html).toContain('viewBox="0 0');
    expect(html).toContain('2 etiket basılacak');
  });

  test('etiket fiyatı ve ürün kodunu taşır, stok adedini taşımaz', async () => {
    // Basılı stok adedi raftaki kağıda bakan kişiyi yanıltır: baskıdan sonraki
    // ilk satışta yanlış olur.
    const shelf = `Etiket İçerik ${Date.now()}`;
    const product = await createProduct({
      name: 'İçerik Kontrol Ürünü',
      shelf_location: shelf,
      sale_price: 88.5,
      stock_quantity: 4242,
    });

    const html = await (
      await request(`/print-labels?shelf=${encodeURIComponent(shelf)}`, staffCookie)
    ).text();

    expect(html).toContain('İçerik Kontrol Ürünü');
    expect(html).toContain('88,50');
    expect(html).toContain(product.code);
    expect(html).toContain(shelf);
    expect(html).not.toContain('4.242');
  });

  test('adres uyarısı sayfada gösterilir', async () => {
    // Beklenen uyarı, sayfanın kullandığı ortam değişkeninden hesaplanıyor:
    // sabit metin yazmak yerine kablolamayı doğruluyoruz. Geliştirme ortamında
    // NEXT_PUBLIC_SITE_URL localhost olduğu için uyarı bekleniyor.
    const { siteUrlFromEnv, siteUrlWarning } = await import('@/lib/label');
    const expected = siteUrlWarning(siteUrlFromEnv(process.env));

    const html = await (await request('/print-labels', staffCookie)).text();

    if (expected === null) {
      expect(html).not.toContain('yeniden basmanız gerekir');
    } else {
      expect(html).toContain(expected.slice(0, 40));
    }
  });

  test('reyon filtresi etiket listesini daraltır', async () => {
    const shelf = `Etiket Filtre ${Date.now()}`;
    await createProduct({ name: 'Etikete Girecek', shelf_location: shelf });
    await createProduct({ name: 'Etikete Girmeyecek', shelf_location: 'Başka Etiket Reyonu' });

    const html = await (
      await request(`/print-labels?shelf=${encodeURIComponent(shelf)}`, staffCookie)
    ).text();

    expect(html).toContain('Etikete Girecek');
    expect(html).not.toContain('Etikete Girmeyecek');
  });

  test('eşleşme yoksa bilgi mesajı gösterilir ve karekod üretilmez', async () => {
    const html = await (
      await request('/print-labels?search=boyle-bir-urun-asla-yok', staffCookie)
    ).text();

    expect(html).toContain('Bu filtrelere uyan ürün yok');
    expect(html).not.toContain('<svg');
  });

  test('görüntüleyici de etiket basabilir', async () => {
    // Etiket basımı okuma işlemi; yazma yetkisi gerektirmiyor.
    const response = await request('/print-labels', viewerCookie);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Yazdır');
  });

  test('filtreler etiket sayfasında kalır, ürün listesine atlamaz', async () => {
    const html = await (await request('/print-labels', staffCookie)).text();

    expect(html).toContain('Reyon');
    expect(html).toContain('Yalnızca kritik stok');
  });
});

describe('ürün düzenleme', () => {
  test('form mevcut değerlerle dolu gelir', async () => {
    const product = await createProduct({
      name: 'Düzenlenecek Ürün',
      sale_price: 45.9,
      stock_quantity: 3,
    });

    const html = await (await request(`/products/${product.id}/edit`, staffCookie)).text();

    expect(html).toContain('Düzenlenecek Ürün');
    expect(html).toContain('45,9');
    expect(html).toContain('Değişiklikleri kaydet');
  });

  test('olmayan ürün 404 döner', async () => {
    const response = await request('/products/999999999/edit', staffCookie);

    expect(response.status).toBe(404);
  });

  test('silme bölümü yalnızca yöneticide görünür', async () => {
    const product = await createProduct({ name: 'Silinebilir Ürün' });

    const adminHtml = await (await request(`/products/${product.id}/edit`, adminCookie)).text();
    const staffHtml = await (await request(`/products/${product.id}/edit`, staffCookie)).text();

    expect(adminHtml).toContain('Ürünü sil');
    expect(staffHtml).not.toContain('Ürünü sil');
  });

  test('görüntüleyici formu göremez', async () => {
    const product = await createProduct({ name: 'Salt Okunur Düzenleme' });

    const html = await (await request(`/products/${product.id}/edit`, viewerCookie)).text();

    expect(html).toContain('Yetkiniz görüntüleme ile sınırlı');
    expect(html).not.toContain('Değişiklikleri kaydet');
  });
});

describe('CSV dışa aktarma', () => {
  test('CSV dosyası indirilir ve Türkçe başlıklar taşır', async () => {
    await createProduct({ name: 'Dışa Aktarılan Ürün', sale_price: 33.25 });

    const response = await request('/api/products/export', staffCookie);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const body = new TextDecoder('utf-8').decode(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');

    // Excel'in dosyayı UTF-8 sayması için BOM gerekiyor. `response.text()`
    // şartname gereği baştaki BOM'u sildiği için ham baytlara bakıyoruz.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body).toContain('Ürün Kodu;Barkod;Ürün Adı');
    expect(body).toContain('Dışa Aktarılan Ürün');
    expect(body).toContain('33,25');
  });

  test('filtreler dışa aktarmaya da uygulanır', async () => {
    const shelf = `Dışa Aktarma Reyonu ${Date.now()}`;
    await createProduct({ name: 'Aktarılacak', shelf_location: shelf });
    await createProduct({ name: 'Aktarılmayacak', shelf_location: 'Diğer Reyon' });

    const body = await (
      await request(`/api/products/export?shelf=${encodeURIComponent(shelf)}`, staffCookie)
    ).text();

    expect(body).toContain('Aktarılacak');
    expect(body).not.toContain('Aktarılmayacak');
  });

  test('görüntüleyici de dışa aktarabilir', async () => {
    const response = await request('/api/products/export', viewerCookie);

    expect(response.status).toBe(200);
  });

  test('dışa aktarılan dosya içe aktarma tarafından sorunsuz okunur', async () => {
    // Mağazanın en sık kullanacağı akış: listeyi indir, Excel'de düzenle, geri
    // yükle. İki tarafın biçimi ayrışırsa bu sessizce bozulur.
    const product = await createProduct({
      name: 'Tur Testi Ürünü',
      sale_price: 1234.56,
      cost_price: 999.99,
      stock_quantity: 7,
      min_stock_alert: 2,
      shelf_location: 'Tur Reyonu',
      barcode: '5901234123457',
    });

    const csv = await (await request('/api/products/export', staffCookie)).text();

    const rows = parseCsv(csv);
    const mapping = detectColumnMapping(rows[0]);

    // Tüm alanlar tanınmalı: başlıklar içe aktarmanın takma adlarıyla uyumlu.
    expect(missingRequiredFields(mapping)).toEqual([]);
    expect(mapping.code).toBeDefined();
    expect(mapping.barcode).toBeDefined();
    expect(mapping.cost_price).toBeDefined();
    expect(mapping.min_stock_alert).toBeDefined();

    const { products, errors } = parseImportRows(rows, mapping);

    // Hiçbir satır doğrulamadan düşmemeli.
    expect(errors).toEqual([]);

    const roundTripped = products.find((row) => row.code === product.code);
    expect(roundTripped).toMatchObject({
      name: 'Tur Testi Ürünü',
      shelf_location: 'Tur Reyonu',
      barcode: '5901234123457',
      // Virgüllü fiyatlar ve binlik ayırıcı doğru çözülmeli.
      sale_price: 1234.56,
      cost_price: 999.99,
      stock_quantity: 7,
      min_stock_alert: 2,
    });
  });
});

describe('CSV içe aktarma ucu', () => {
  test('personel ürün aktarabilir', async () => {
    const code = uniqueProductCode();

    const response = await request('/api/products/import', staffCookie, {
      method: 'POST',
      body: JSON.stringify({
        products: [
          {
            code,
            barcode: null,
            name: 'HTTP ile aktarılan',
            shelf_location: 'HTTP Reyonu',
            sale_price: 25,
            stock_quantity: 3,
          },
        ],
      }),
    });
    const payload = (await response.json()) as { inserted: number; updated: number };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ inserted: 1, updated: 0 });

    const { data } = await admin.from('products').select('id').eq('code', code).single();
    createdProductIds.push((data as { id: number }).id);
  });

  test('görüntüleyici aktarma yapamaz', async () => {
    const response = await request('/api/products/import', viewerCookie, {
      method: 'POST',
      body: JSON.stringify({
        products: [
          {
            code: uniqueProductCode(),
            barcode: null,
            name: 'İzinsiz',
            shelf_location: 'Reyon',
            sale_price: 10,
          },
        ],
      }),
    });

    expect(response.status).toBe(403);
  });

  test('geçersiz satır 400 döner', async () => {
    const response = await request('/api/products/import', staffCookie, {
      method: 'POST',
      body: JSON.stringify({
        products: [{ barcode: null, name: '', shelf_location: '', sale_price: -1 }],
      }),
    });

    expect(response.status).toBe(400);
  });

  test('aynı kod iki kez gönderilirse reddedilir', async () => {
    const code = uniqueProductCode();
    const row = {
      code,
      barcode: null,
      name: 'Kopya',
      shelf_location: 'Reyon',
      sale_price: 10,
    };

    const response = await request('/api/products/import', staffCookie, {
      method: 'POST',
      body: JSON.stringify({ products: [row, row] }),
    });
    const payload = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(payload.error.message).toContain('birden fazla geçiyor');
  });

  test('boş liste reddedilir', async () => {
    const response = await request('/api/products/import', staffCookie, {
      method: 'POST',
      body: JSON.stringify({ products: [] }),
    });

    expect(response.status).toBe(400);
  });
});

describe('içe aktarma sayfası', () => {
  test('personel sayfayı açabilir', async () => {
    const html = await (await request('/products/import', staffCookie)).text();

    expect(html).toContain('CSV yükle');
    expect(html).toContain('Zorunlu kolonlar');
  });

  test('görüntüleyici sayfayı açamaz', async () => {
    const html = await (await request('/products/import', viewerCookie)).text();

    expect(html).toContain('İçe aktarma yetkiniz yok');
    expect(html).not.toContain('Dosya seç');
  });
});

describe('yeni ürün sayfası', () => {
  test('personel formu açabilir ve sıradaki kod önerilir', async () => {
    const response = await request('/products/new', staffCookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Yeni ürün');
    expect(html).toContain('Ürün kodu');
    expect(html).toMatch(/ENV-\d+/);
  });

  test('taranan barkod forma yerleşir', async () => {
    const html = await (await request('/products/new?barcode=4006381333931', staffCookie)).text();

    expect(html).toContain('4006381333931');
    expect(html).toContain('Okunan barkod alana yerleştirildi');
  });

  test('görüntüleyici rolü formu göremez', async () => {
    const html = await (await request('/products/new', viewerCookie)).text();

    expect(html).toContain('Ürün ekleme yetkiniz yok');
    expect(html).not.toContain('Kritik stok eşiği');
  });
});

describe('oturumlu API erişimi', () => {
  test('personel ürün listesini alabilir', async () => {
    const response = await request('/api/products?limit=5', staffCookie);
    const body = (await response.json()) as { products?: unknown[]; stats?: unknown };

    expect(response.status).toBe(200);
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.stats).toBeDefined();
  });

  test('görüntüleyici de listeyi okuyabilir', async () => {
    const response = await request('/api/products?limit=1', viewerCookie);

    expect(response.status).toBe(200);
  });

  test('taranan kodla ürün bulunur', async () => {
    const product = await createProduct();

    const response = await request(
      `/api/products/by-code?code=${encodeURIComponent(product.code)}`,
      staffCookie,
    );
    const body = (await response.json()) as { product?: { id: number }; scan?: { kind: string } };

    expect(response.status).toBe(200);
    expect(body.product?.id).toBe(product.id);
  });

  test('bulunamayan kod hata değil, boş sonuç döner', async () => {
    const response = await request('/api/products/by-code?code=ENV-99999999', staffCookie);
    const body = (await response.json()) as { product: unknown; scan: { kind: string } };

    expect(response.status).toBe(200);
    expect(body.product).toBeNull();
    expect(body.scan.kind).toBe('qr');
  });

  test('personel stok düşürebilir', async () => {
    const product = await createProduct({ stock_quantity: 8 });

    const response = await request(`/api/products/${product.id}/adjust`, staffCookie, {
      method: 'POST',
      body: JSON.stringify({ stockDelta: -1, note: 'HTTP testi' }),
    });
    const body = (await response.json()) as { product: { stock_quantity: number } };

    expect(response.status).toBe(200);
    expect(body.product.stock_quantity).toBe(7);
  });

  test('görüntüleyici stok düşüremez', async () => {
    const product = await createProduct({ stock_quantity: 8 });

    const response = await request(`/api/products/${product.id}/adjust`, viewerCookie, {
      method: 'POST',
      body: JSON.stringify({ stockDelta: -1 }),
    });

    expect(response.status).toBe(403);

    const { data } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', product.id)
      .single();

    expect(data?.stock_quantity).toBe(8);
  });

  test('personel ürün ekleyebilir, görüntüleyici ekleyemez', async () => {
    const payload = {
      name: 'HTTP ile eklenen',
      shelf_location: 'HTTP Reyonu',
      sale_price: 12.5,
    };

    const staffResponse = await request('/api/products', staffCookie, {
      method: 'POST',
      body: JSON.stringify({ ...payload, code: uniqueProductCode() }),
    });
    const created = (await staffResponse.json()) as { product: { id: number } };

    expect(staffResponse.status).toBe(201);
    createdProductIds.push(created.product.id);

    const viewerResponse = await request('/api/products', viewerCookie, {
      method: 'POST',
      body: JSON.stringify({ ...payload, code: uniqueProductCode() }),
    });

    expect(viewerResponse.status).toBe(403);
  });

  test('yalnızca yönetici ürün silebilir', async () => {
    const product = await createProduct();

    const staffResponse = await request(`/api/products/${product.id}`, staffCookie, {
      method: 'DELETE',
    });
    expect(staffResponse.status).toBe(403);

    const adminResponse = await request(`/api/products/${product.id}`, adminCookie, {
      method: 'DELETE',
    });
    expect(adminResponse.status).toBe(200);
  });

  test('geçersiz gövde 400 ve açıklayıcı mesaj döndürür', async () => {
    const response = await request('/api/products', staffCookie, {
      method: 'POST',
      body: JSON.stringify({ name: '', shelf_location: '', sale_price: -5 }),
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain('Ürün adı zorunlu');
  });

  test('çakışan ürün kodu 409 döndürür', async () => {
    const product = await createProduct();

    const response = await request('/api/products', staffCookie, {
      method: 'POST',
      body: JSON.stringify({
        code: product.code,
        name: 'Kopya',
        shelf_location: 'HTTP Reyonu',
        sale_price: 10,
      }),
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(409);
    expect(body.error.message).toContain('ürün kodu');
  });

  test('devre dışı bırakılan personelin oturumu iş görmez', async () => {
    const suspended = await createTestUser('staff');

    try {
      const cookie = await createSessionCookieHeader(suspended.email, suspended.password);

      // Oturum geçerli, ancak profil devre dışı.
      await admin.from('profiles').update({ is_active: false }).eq('id', suspended.id);

      const response = await request('/api/products', cookie);

      expect(response.status).toBe(401);
    } finally {
      await deleteTestUser(suspended);
    }
  });
});
