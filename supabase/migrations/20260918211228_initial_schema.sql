-- ReyonStok temel şeması: personel profilleri, ürünler ve stok hareket kaydı.
--
-- Tasarım notları:
--  * Tek mağaza varsayımı. İleride çoklu mağazaya geçilirse products ve
--    stock_logs tablolarına store_id eklenmesi yeterli olacak şekilde sade tutuldu.
--  * Ürünün iki farklı kodu olabilir: `code` bizim ürettiğimiz karekod (ENV-1001),
--    `barcode` üreticinin ürün üstündeki barkodu (çoğunlukla EAN-13).
--  * Para alanları numeric(12,2); kuruş hataları olmaması için float kullanılmadı.

-- ---------------------------------------------------------------------------
-- Türler
-- ---------------------------------------------------------------------------

-- Personel yetki seviyeleri.
--   admin  : her şey + kullanıcı yönetimi + ürün silme
--   staff  : ürün ekleme/düzenleme + stok ve fiyat güncelleme
--   viewer : yalnızca görüntüleme
create type public.user_role as enum ('admin', 'staff', 'viewer');

-- Stok hareketinin sebebi.
create type public.stock_log_type as enum (
  'initial_count',     -- ürün ilk kaydedildiğinde
  'stock_adjustment',  -- adet değişimi (+1 / -1 / sayım)
  'price_update',      -- yalnızca fiyat değişti
  'scan_action',       -- tarama sonrası kayıt (adet ve fiyat aynı kaldı)
  'import'             -- CSV içe aktarma
);

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

-- Supabase Auth kullanıcısının uygulama içindeki karşılığı. Rol bilgisinin
-- kaynağı burasıdır; auth.users tablosuna kolon eklenmez.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role public.user_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Personel profilleri ve yetki seviyeleri. Her auth.users satırı için trigger ile açılır.';

create table public.products (
  id bigint generated always as identity primary key,

  -- Reyon etiketine bastığımız karekodun içeriği. Büyük harfle saklanır ki
  -- tarama tarafındaki normalleştirme ile birebir eşleşsin.
  code text not null unique
    constraint products_code_not_blank check (length(btrim(code)) > 0)
    constraint products_code_uppercase check (code = upper(code)),

  -- Üreticinin barkodu. Boş olabilir; Code-128 gibi biçimlerde harf büyüklüğü
  -- anlamlı olduğu için büyük harfe çevrilmez.
  barcode text unique
    constraint products_barcode_not_blank check (barcode is null or length(btrim(barcode)) > 0),

  name text not null
    constraint products_name_not_blank check (length(btrim(name)) > 0),
  category text not null default 'Genel',
  shelf_location text not null
    constraint products_shelf_not_blank check (length(btrim(shelf_location)) > 0),

  cost_price numeric(12, 2) not null default 0
    constraint products_cost_price_non_negative check (cost_price >= 0),
  sale_price numeric(12, 2) not null
    constraint products_sale_price_non_negative check (sale_price >= 0),

  stock_quantity integer not null default 0
    constraint products_stock_non_negative check (stock_quantity >= 0),
  min_stock_alert integer not null default 3
    constraint products_min_stock_non_negative check (min_stock_alert >= 0),

  unit text not null default 'Adet',
  notes text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.products.code is
  'Reyon etiketindeki karekodun işaret ettiği ürün kodu (ENV-1001). Her zaman büyük harf.';
comment on column public.products.barcode is
  'Üreticinin ürün üstündeki barkodu, çoğunlukla EAN-13. Boş olabilir.';

-- Filtreleme sorguları için (reyona göre listeleme, kategori filtresi).
create index products_shelf_location_idx on public.products (shelf_location);
create index products_category_idx on public.products (category);

-- Kritik stok raporu: stock_quantity <= min_stock_alert olan satırlar.
create index products_low_stock_idx on public.products (stock_quantity)
  where stock_quantity <= min_stock_alert;

-- Değiştirilemez hareket kaydı. Kim, hangi ürünü, ne zaman, nasıl değiştirdi.
create table public.stock_logs (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id) on delete cascade,

  -- Kullanıcı silinse bile hareket kaydı kaybolmasın diye set null.
  user_id uuid references public.profiles (id) on delete set null,

  change_amount integer not null default 0,
  old_stock integer not null,
  new_stock integer not null,
  old_price numeric(12, 2),
  new_price numeric(12, 2),

  type public.stock_log_type not null default 'stock_adjustment',
  note text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.stock_logs is
  'Stok ve fiyat değişimlerinin denetim kaydı. Güncelleme ve silme politikası tanımlanmadığı için değiştirilemez.';

-- Ürün detayındaki "son hareketler" listesi.
create index stock_logs_product_created_idx
  on public.stock_logs (product_id, created_at desc);

-- Ana paneldeki "son hareketler" listesi.
create index stock_logs_created_idx on public.stock_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Tetikleyiciler
-- ---------------------------------------------------------------------------

-- updated_at alanını her güncellemede tazeler.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- Yeni Auth kullanıcısı için profil satırı açar. Varsayılan rol en kısıtlı
-- olan viewer; yetkiyi admin sonradan yükseltir.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
