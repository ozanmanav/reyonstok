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
| Lint + biçim | Biome (ESLint'in yerini aldı) |
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
| `npm run lint` | Biome: lint + biçim denetimi + import sıralaması |
| `npm run lint:fix` | Düzeltilebilenleri uygular |
| `npm run format` | Yalnızca biçimlendirir |
| `npm run build` | Üretim derlemesi |
| `node scripts/smoke-test.mjs <adres> <eposta> <sifre>` | Yayındaki sürümü denetler |
| `node scripts/generate-icons.mjs` | PWA ikonlarını SVG'den yeniden üretir (Chrome gerekir) |

Testler tek bir bulut Supabase projesini paylaştığı için sırayla koşar
(`fileParallelism: false`). Elle başlatılmış bir `npm run dev` açıkken
`npm test` çalıştırmayın; ikisi aynı `.next` dizini için çekişir.

## Lint ve biçim: neden Biome

ESLint ve `eslint-config-next` kaldırıldı, yerine Biome geldi.

Asıl gerekçe sürüm tıkanıklığıydı. `eslint-config-next` iki bağımlılığı
taşıyordu ve ikisi de yükseltmeleri kilitliyordu: `eslint-plugin-react` ESLint
10'da kaldırılan bir API'yi çağırıp lint'i çökertiyordu, `typescript-eslint` ise
TypeScript 7'yi açıkça reddediyordu. Biome kendi çözümleyicisini kullandığı için
TypeScript sürümünden bağımsız; geçişle birlikte **TypeScript 7'ye çıkıldı** ve
derlemedeki tip denetimi 1988 ms'den 379 ms'ye düştü. Bağımlılık sayısı da
521'den 216 pakete indi.

Biome yapılandırması `biome.jsonc` içinde, her karar gerekçesiyle yazılı.
Etkinleştirilen alanlar (domains): `next`, `react`, `test`.

Geçiş sırasında Biome'un yakaladığı ve **ESLint'in kaçırdığı** gerçek hatalar:

- `ProductQuickCard` içinde fiyat ve stok değerleri `<p aria-labelledby=...>`
  ile etiketlerine bağlanmıştı. Bu sessizce etkisizdi: paragraph rolü
  erişilebilir ad kabul etmiyor, ekran okuyucu bağlantıyı yok sayıyordu.
  Testler geçiyordu çünkü testing-library adı kendi hesaplıyor. `dt`/`dd`
  ile yeniden yazıldı, ARIA'ya gerek kalmadı.
- Kamera önizlemesi `aria-hidden="true"` idi ama odaklanabilirdi — klavyeyle
  gezinen kullanıcı, ekran okuyucunun görmediği bir yere düşüyordu.
- `forEach` içinde değer döndüren kısa ok fonksiyonları (`map` demek istendiği
  şüphesi).

Güvenlik ağının gerçekten devrede olduğu mutasyon testiyle doğrulandı: koşullu
hook çağrısı `useHookAtTopLevel`, eksik bağımlılık `useExhaustiveDependencies`
tarafından yakalanıyor.

### Bilinen boşluklar

| ESLint'te olan | Biome durumu |
| --- | --- |
| `@next/next/no-html-link-for-pages` | Karşılığı yok; `<Link>` yerine `<a href="/x">` yazılırsa uyarı gelmez |
| `@next/next/no-assign-module-variable` | Karşılığı yok |
| `react-hooks/set-state-in-effect` | En yakını `nursery/useReactCompiler`, KAPALI |

`useReactCompiler` denendi ve kapalı bırakıldı: kural henüz kararsız (nursery) ve
tek bulgusu `BarcodeScanner` içindeki kare okuma döngüsünün karşılıklı
özyinelemesi. O döngüdeki değişken durum tamamen ref'lerde tutulduğu için
bayatlama riski yok; kural bunu kanıtlayamıyor. Kararsız bir kuralı, ancak gerçek
cihazda doğrulanabilecek bir döngü için kapı bekçisi yapmak doğru bulunmadı.

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
