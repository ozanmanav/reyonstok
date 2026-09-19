# ReyonStok

Mağaza reyonlarındaki karekodu telefonla okutup ürünün fiyatını ve stoğunu gören,
tek dokunuşla stok/fiyat düzeltmesi yapan mobil web uygulaması (PWA).

İki tür kod okunur:

- **Reyon karekodu** (`ENV-1001`) — bizim ürettiğimiz, rafa yapıştırılan etiket.
  Karekodun içine `https://<adres>/scan?code=ENV-1001` gömülür, böylece telefonun
  kendi kamera uygulaması da doğrudan ürün sayfasını açar.
- **Ürün barkodu** (EAN-13) — üreticinin ambalaj üstündeki barkodu. Kontrol hanesi
  doğrulanır.

## Yığın

| Katman | Seçim |
| --- | --- |
| Uygulama | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Veritabanı | Supabase Postgres + satır düzeyi güvenlik (RLS) |
| Kimlik | Supabase Auth, httpOnly çerezle sunucu tarafı oturum |
| Barkod | `barcode-detector` — yerleşik `BarcodeDetector`, yoksa ZXing WASM |
| Test | Vitest, gerçek Supabase projesine ve gerçek dev sunucusuna karşı |
| Barındırma | Vercel (`iad1`), Supabase Vercel Marketplace entegrasyonuyla |

## Kurulum

```bash
npm install
vercel env pull .env.local   # Supabase adresi ve anahtarları
npm run dev
```

`npm run dev` kullanın, `npm start` değil: oturum çerezi üretimde `secure`
işaretli olduğu için `http://localhost` üzerinden giriş çalışmaz.

İlk yönetici hesabını açın — veritabanı trigger'ı her yeni hesabı en kısıtlı rol
olan `viewer` ile açtığı için bu adım atlanamaz:

```bash
node scripts/create-user.mjs eposta@ornek.com "guclu-bir-sifre" admin "Ad Soyad"
```

## Komutlar

| Komut | İş |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu (WASM dosyasını da kopyalar) |
| `npm test` | Tüm testler (~2 dk, gerçek veritabanına bağlanır) |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Üretim derlemesi |
| `node scripts/smoke-test.mjs <adres> <eposta> <sifre>` | Yayındaki sürümü denetler |
| `node scripts/generate-icons.mjs` | PWA ikonlarını SVG'den yeniden üretir (Chrome gerekir) |

Testler tek bir bulut Supabase projesini paylaştığı için sırayla koşar
(`fileParallelism: false`). Elle başlatılmış bir `npm run dev` açıkken
`npm test` çalıştırmayın; ikisi aynı `.next` dizini için çekişir.

### Sürüm tavanı

Bağımlılıklar tam sürümle sabitlenmiştir. İkisi bilinçli olarak en son
sürümde DEĞİL, çünkü Next.js'in lint zinciri henüz desteklemiyor:

| Paket | Kullanılan | Son sürüm | Engel |
| --- | --- | --- | --- |
| `eslint` | 9.39.5 | 10.11.0 | `eslint-plugin-react` (eslint-config-next içinden) ESLint 10'da kaldırılan `context.getFilename()`'i çağırıyor; peer aralığı `^9.7`'de bitiyor ve düzeltilmiş bir sürümü yok |
| `typescript` | 6.0.3 | 7.0.2 | `typescript-eslint` TS 7'yi açıkça reddediyor ([takip](https://github.com/typescript-eslint/typescript-eslint/issues/10940)). TS 6.0.3, zincirin desteklediği en yeni sürüm (`>=4.8.4 <6.1.0`) |

İkisini zorlamak lint'i tamamen devre dışı bırakmak anlamına geliyor; bu projede
`react-hooks` kuralları gerçek hatalar yakaladığı için o takas kabul edilmedi.
Engeller kalktığında yükseltilmeli.

## Roller

| Rol | Yetki |
| --- | --- |
| `admin` | Her şey + personel yönetimi + ürün silme |
| `staff` | Ürün ekleme/düzenleme + stok ve fiyat güncelleme |
| `viewer` | Yalnızca görüntüleme (etiket basımı dahil, okuma işlemi) |

Yetki üç katmanda uygulanır: arayüzde gizleme (yalnızca kolaylık), sunucuda
`requireRole`, veritabanında RLS politikaları. İlki güvenlik önlemi değildir.

## Veritabanı

Migration'lar buluttaki projeye uygulanır, yerel Docker yığını kullanılmaz:

```bash
supabase db push --linked
supabase db push --linked --include-seed   # örnek ürünlerle
```

Stok ve fiyat güncellemesi `adjust_stock_and_price` fonksiyonundan geçer.
Aritmetik SQL içinde yapılır ve satır `for update` ile kilitlenir; uygulamada
oku-değiştir-yaz yapılsaydı aynı ürünü aynı anda güncelleyen iki personelden
birinin işlemi kaybolurdu. `stock_logs` tablosunda `update`/`delete` politikası
yoktur, denetim kaydı değiştirilemez.

## Reyon etiketi basımı

`/print-labels` sayfası filtredeki ürünler için etiket hazırlar. Karekodlar
**sunucuda** SVG'ye çevrilir: tarayıcıda üretilseydi yazdırma penceresi
JavaScript'i beklerdi, `<img>` ile getirilseydi yüklenmeden basılan boş kareler
çıkabilirdi.

| Düzen | Ölçü |
| --- | --- |
| A4 | 3 sütun, sayfa başına 18 etiket, karekod 18 mm |
| Termal | 58 × 40 mm, her etiket ayrı sayfa, karekod 15 mm |

Fiziksel ölçüler `src/app/globals.css` içindeki `@media print` bloğunda
milimetre cinsindendir; piksel ölçüleri yazıcıya göre değişir, karekodun kaç
milimetre basıldığı ise okunabilirliği doğrudan belirler.

Etikete **stok adedi basılmaz**: basıldığı anda eskir ve raftaki kağıda bakan
kişiyi yanıltır. Bunun yerine basım tarihi yazılır.

`NEXT_PUBLIC_SITE_URL` tanımlı değilse veya `localhost`'u gösteriyorsa sayfa
uyarı verir. Değer yoksa karekoda düz ürün kodu basılır; uygulama içindeki
tarayıcı okur ama telefonun kamera uygulaması bir sayfa açamaz.

## Dağıtım

Vercel projesi CLI ile bağlıdır, GitHub'a bağlı değildir — push dağıtım
tetiklemez:

```bash
vercel --prod
node scripts/smoke-test.mjs https://reyonstok.vercel.app <eposta> <sifre>
```

`NEXT_PUBLIC_SITE_URL` yalnızca Production ve Development ortamlarında tanımlı.
Preview'da bilinçli olarak boş: kod Vercel'in kalıcı üretim adresine
(`VERCEL_PROJECT_PRODUCTION_URL`) düşer, böylece preview'dan basılan etiket de
gerçek adresi gösterir. Dağıtıma özgü `VERCEL_URL` kullanılmaz; her yayında
değişip basılmış etiketleri geçersiz kılardı.
