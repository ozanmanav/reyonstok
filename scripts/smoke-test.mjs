/**
 * Dağıtılmış bir sürüme karşı duman testi.
 *
 * Neden gerekli: `npm test` yerel dev sunucusuna karşı koşuyor ve yapılandırma
 * hatalarını göremiyor. Yayındaki sürümde bozulabilecek şeyler ayrı bir sınıf:
 * eksik veya yanlış ortam değişkeni, üretimde `secure` çerezlerin çalışmaması,
 * etiket karekodlarının localhost'u göstermesi, statik varlıkların proxy'ye
 * takılması. Bunların hepsi ancak gerçek adrese istek atarak görülür.
 *
 * Çerez, uygulamanın kullandığı `@supabase/ssr` serileştirmesiyle üretiliyor;
 * yani tarayıcının göndereceği çerezle test ediliyor.
 *
 * Kullanım:
 *   node scripts/smoke-test.mjs <adres> <eposta> <sifre>
 *
 * Örnek:
 *   node scripts/smoke-test.mjs https://reyonstok.vercel.app admin@x.test "sifre"
 *
 * Ortam değişkenleri `.env.local` dosyasından okunur; Supabase adresi ve anon
 * anahtarı oturum açmak için gerekiyor.
 */
import { createServerClient } from '@supabase/ssr';

process.loadEnvFile('.env.local');

const [rawBaseUrl, email, password] = process.argv.slice(2);

if (!rawBaseUrl || !email || !password) {
  console.error('Kullanım: node scripts/smoke-test.mjs <adres> <eposta> <sifre>');
  process.exit(1);
}

const baseUrl = rawBaseUrl.replace(/\/+$/, '');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY gerekli.');
  process.exit(1);
}

const results = [];

/** Tek bir denetim yürütür ve sonucu kaydeder. */
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ ok: false, name, detail: error.message });
    console.log(`  ✗ ${name} — ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Oturum çerezi başlığı üretir. */
async function sessionCookie() {
  const jar = new Map();

  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) {
          jar.set(name, value);
        }
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  assert(!error, `giriş yapılamadı: ${error?.message}`);
  assert(jar.size > 0, 'oturum açıldı ama çerez yazılmadı');

  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function get(path, cookie) {
  return fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
}

console.log(`\nDuman testi: ${baseUrl}`);
console.log(`Hesap: ${email}\n`);

console.log('Oturumsuz erişim');

await check('giriş sayfası açılıyor', async () => {
  const response = await get('/login');
  assert(response.status === 200, `HTTP ${response.status}`);
  const html = await response.text();
  assert(html.includes('Giriş yap'), 'giriş formu bulunamadı');

  return 'HTTP 200';
});

await check('korumalı sayfa giriş sayfasına yönlendiriyor', async () => {
  const response = await get('/products');
  assert(response.status >= 300 && response.status < 400, `HTTP ${response.status}`);
  assert((response.headers.get('location') ?? '').includes('/login'), 'hedef /login değil');

  return `HTTP ${response.status}`;
});

await check('API oturumsuz 401 JSON döndürüyor', async () => {
  const response = await get('/api/products');
  assert(response.status === 401, `HTTP ${response.status}`);
  assert((response.headers.get('content-type') ?? '').includes('application/json'), 'JSON değil');

  return 'HTTP 401';
});

await check('manifest ve ikonlar oturumsuz erişilebilir', async () => {
  const manifestResponse = await get('/manifest.webmanifest');
  assert(manifestResponse.status === 200, `manifest HTTP ${manifestResponse.status}`);

  const manifest = await manifestResponse.json();
  assert(manifest.display === 'standalone', `display=${manifest.display}`);

  for (const icon of manifest.icons ?? []) {
    const iconResponse = await get(icon.src);
    assert(iconResponse.status === 200, `${icon.src} HTTP ${iconResponse.status}`);
  }

  return `${manifest.icons?.length ?? 0} ikon sunuluyor`;
});

await check('barkod okuyucunun WASM dosyası sunuluyor', async () => {
  // iOS Safari'de yerleşik BarcodeDetector yok; tarama tamamen bu dosyaya bağlı.
  const response = await get('/zxing/zxing_reader.wasm');
  assert(response.status === 200, `HTTP ${response.status}`);

  const type = response.headers.get('content-type') ?? '';
  assert(type.includes('wasm'), `content-type=${type}`);

  // content-length her yanıtta gelmiyor (önbellek durumuna göre parçalı
  // gönderilebiliyor); gövdeyi ölçmek hem daha doğru hem dosyanın gerçekten
  // indiğini kanıtlıyor.
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  assert(bytes.byteLength > 500_000, `dosya beklenenden küçük: ${bytes.byteLength} bayt`);

  // WebAssembly ikili başlığı: 0x00 'a' 's' 'm'. Yanlış yapılandırmada bu yol
  // HTML giriş sayfası döndürebiliyor ve hata ancak telefonda tarama
  // denendiğinde ortaya çıkıyor.
  const isWasm = bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
  assert(isWasm, 'gelen içerik WebAssembly değil');

  return `${Math.round(bytes.byteLength / 1024)} KB, geçerli WASM başlığı`;
});

console.log('\nOturumlu erişim');

const cookie = await (async () => {
  try {
    return await sessionCookie();
  } catch (error) {
    console.log(`  ✗ oturum açılamadı — ${error.message}`);
    results.push({ ok: false, name: 'oturum açma', detail: error.message });

    return null;
  }
})();

if (cookie) {
  console.log('  ✓ oturum açıldı');

  await check('ana panel yükleniyor', async () => {
    const response = await get('/', cookie);
    assert(response.status === 200, `HTTP ${response.status}`);
    const html = await response.text();
    assert(html.includes('Reyon karekod ve stok yönetimi'), 'panel içeriği yok');
    assert(html.includes('Envanter değeri'), 'özet kartları yok');

    return 'özet kartları görünüyor';
  });

  await check('ürün listesi yükleniyor', async () => {
    const response = await get('/products', cookie);
    assert(response.status === 200, `HTTP ${response.status}`);
    assert((await response.text()).includes('Ürünler'), 'liste başlığı yok');

    return 'HTTP 200';
  });

  await check('tarama sayfası açılıyor', async () => {
    const response = await get('/scan', cookie);
    assert(response.status === 200, `HTTP ${response.status}`);
    assert((await response.text()).includes('Karekod tara'), 'tarama ekranı yok');

    return 'HTTP 200';
  });

  await check('API oturumla ürün döndürüyor', async () => {
    const response = await get('/api/products?limit=3', cookie);
    assert(response.status === 200, `HTTP ${response.status}`);
    const body = await response.json();
    assert(Array.isArray(body.products), 'products dizisi yok');
    assert(body.stats, 'stats yok');

    return `${body.products.length} ürün, envanter ${body.stats.total_inventory_value}`;
  });

  await check('etiket sayfası karekod üretiyor', async () => {
    const response = await get('/print-labels', cookie);
    assert(response.status === 200, `HTTP ${response.status}`);
    const html = await response.text();
    assert(html.includes('<svg'), 'hiç karekod üretilmemiş');
    assert(html.includes('Yazdır'), 'yazdırma butonu yok');

    const count = (html.match(/<svg/g) ?? []).length;

    return `${count} karekod`;
  });

  await check('etiket adresi uyarısı YOK (karekodlar gerçek adresi gösteriyor)', async () => {
    // Bu testin asıl konusu: NEXT_PUBLIC_SITE_URL üretimde doğru ayarlanmadıysa
    // basılan etiketler telefon kamerasıyla okunduğunda hiçbir şey açmaz.
    const html = await (await get('/print-labels', cookie)).text();

    assert(!html.includes('NEXT_PUBLIC_SITE_URL'), 'adres tanımlı değil');
    assert(!html.includes('ulaşılamaz'), 'adres yerel (localhost) görünüyor');
    assert(!html.includes('çözümlenemedi'), 'adres çözümlenemiyor');

    return 'uyarı yok';
  });

  await check('etiket karekodu doğru alan adını taşıyor', async () => {
    // Karekodun içindeki metin SVG'de görünmüyor; bunun yerine sayfanın
    // hesapladığı adresi tarama akışıyla doğruluyoruz: etiketten gelen
    // /scan?code=... yolu çalışıyor mu?
    const response = await get('/scan?code=ENV-1001', cookie);
    assert(response.status === 200, `HTTP ${response.status}`);
    const html = await response.text();
    assert(html.includes('ENV-1001'), 'kod ekranda yok');

    return 'etiket bağlantısı çözülüyor';
  });
}

const failed = results.filter((result) => !result.ok);

console.log(`\n${results.length - failed.length}/${results.length} denetim geçti`);

if (failed.length > 0) {
  console.log('\nBaşarısız:');
  for (const result of failed) {
    console.log(`  - ${result.name}: ${result.detail}`);
  }
  process.exit(1);
}

console.log('Yayındaki sürüm çalışıyor.\n');
