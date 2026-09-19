-- Kritik stok filtresi için üretilmiş kolon.
--
-- Neden gerekli: kritik stok koşulu iki kolonun karşılaştırılmasıdır
-- (stock_quantity <= min_stock_alert). PostgREST bir kolonu başka bir kolonla
-- karşılaştırmayı desteklemiyor; filtre değeri her zaman sabit kabul ediliyor.
-- Koşulu veritabanında üretilmiş bir kolona taşıyınca API üzerinden
-- `is_low_stock=eq.true` olarak filtrelenebiliyor ve index'lenebiliyor.

alter table public.products
  add column is_low_stock boolean
  generated always as (stock_quantity <= min_stock_alert) stored;

comment on column public.products.is_low_stock is
  'Stok kritik eşiğe düştü mü. stock_quantity ve min_stock_alert alanlarından otomatik üretilir, elle yazılamaz.';

-- Eski kısmi index'in yerini üretilmiş kolon üzerindeki kısmi index alıyor.
drop index if exists public.products_low_stock_idx;

create index products_low_stock_idx on public.products (is_low_stock)
  where is_low_stock;
