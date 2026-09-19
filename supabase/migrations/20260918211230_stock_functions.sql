-- Stok/fiyat güncellemesi ve envanter özeti.

-- ---------------------------------------------------------------------------
-- Atomik stok ve fiyat güncellemesi
-- ---------------------------------------------------------------------------
--
-- Neden veritabanı fonksiyonu:
-- İki personel aynı reyonu aynı anda okutup "-1" dediğinde, uygulama tarafında
-- oku-değiştir-yaz yapılırsa biri diğerinin yazdığını ezer ve stok bir eksik
-- düşer. Burada satır önce kilitleniyor (for update), güncelleme ve hareket
-- kaydı aynı işlemde yapılıyor; ikinci çağrı birincinin sonucunu görerek devam
-- eder.
--
-- Yetki: fonksiyon security invoker (varsayılan) olarak bırakıldı, yani RLS
-- çağıran kullanıcıya göre uygulanır. viewer rolü çağırdığında UPDATE hiçbir
-- satıra dokunmaz ve aşağıdaki kontrol yetki hatası fırlatır.
--
-- Parametreler:
--   p_stock_delta     : göreli değişim (-1, +1, +5)
--   p_absolute_stock  : sayımda bulunan kesin adet
--   p_new_sale_price  : yeni satış fiyatı (NULL ise fiyat değişmez)
-- p_stock_delta ve p_absolute_stock birlikte verilemez.
create or replace function public.adjust_stock_and_price(
  p_product_id bigint,
  p_stock_delta integer default null,
  p_absolute_stock integer default null,
  p_new_sale_price numeric default null,
  p_note text default ''
)
returns public.products
language plpgsql
set search_path = ''
as $$
declare
  v_before public.products;
  v_after public.products;
  v_change integer;
  v_type public.stock_log_type;
begin
  if p_stock_delta is not null and p_absolute_stock is not null then
    raise exception 'Stok değişimi ile sayılan adet birlikte gönderilemez'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_new_sale_price is not null and p_new_sale_price < 0 then
    raise exception 'Satış fiyatı negatif olamaz'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Satırı kilitle. Eş zamanlı ikinci çağrı burada bekler ve kilit açıldığında
  -- güncellenmiş satırı okur.
  select * into v_before
    from public.products
   where id = p_product_id
   for update;

  if not found then
    raise exception 'Ürün bulunamadı (id: %)', p_product_id
      using errcode = 'no_data_found';
  end if;

  update public.products
     set stock_quantity = case
           when p_absolute_stock is not null then greatest(0, p_absolute_stock)
           when p_stock_delta is not null then greatest(0, stock_quantity + p_stock_delta)
           else stock_quantity
         end,
         sale_price = coalesce(p_new_sale_price, sale_price)
   where id = p_product_id
  returning * into v_after;

  -- RLS güncellemeyi engellediyse hiçbir satır dönmez.
  if v_after.id is null then
    raise exception 'Bu işlem için yetkiniz yok'
      using errcode = 'insufficient_privilege';
  end if;

  v_change := v_after.stock_quantity - v_before.stock_quantity;

  -- Hiçbir şey değişmediyse denetim kaydını şişirmeyelim.
  if v_change = 0 and v_after.sale_price = v_before.sale_price then
    return v_after;
  end if;

  v_type := case
    when v_change <> 0 then 'stock_adjustment'::public.stock_log_type
    else 'price_update'::public.stock_log_type
  end;

  insert into public.stock_logs (
    product_id, user_id, change_amount,
    old_stock, new_stock, old_price, new_price,
    type, note
  )
  values (
    p_product_id, (select auth.uid()), v_change,
    v_before.stock_quantity, v_after.stock_quantity,
    v_before.sale_price, v_after.sale_price,
    v_type, coalesce(p_note, '')
  );

  return v_after;
end;
$$;

comment on function public.adjust_stock_and_price is
  'Stok ve/veya fiyatı tek işlemde günceller, hareket kaydını kullanıcı kimliğiyle yazar. Eş zamanlı çağrılarda satır kilidi sayesinde güncellemeler kaybolmaz.';

-- Oturumsuz erişimi kapat, yalnızca giriş yapmış personele açık olsun.
revoke all on function public.adjust_stock_and_price(bigint, integer, integer, numeric, text) from anon;
grant execute on function public.adjust_stock_and_price(bigint, integer, integer, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Envanter özeti (ana panel KPI kartları)
-- ---------------------------------------------------------------------------
--
-- security_invoker = on: görünüm, çağıran kullanıcının RLS politikalarıyla
-- çalışır. Aksi halde görünümün sahibi (postgres) yetkisiyle çalışıp veriyi
-- politikaların dışına sızdırırdı.
create view public.inventory_stats
with (security_invoker = on)
as
select
  count(*)::bigint as total_products,
  coalesce(sum(stock_quantity), 0)::bigint as total_stock_units,
  coalesce(sum(stock_quantity * sale_price), 0)::numeric(14, 2) as total_inventory_value,
  count(*) filter (
    where stock_quantity > 0 and stock_quantity <= min_stock_alert
  )::bigint as low_stock_count,
  count(*) filter (where stock_quantity = 0)::bigint as out_of_stock_count,
  count(distinct shelf_location)::bigint as shelves_count
from public.products;

comment on view public.inventory_stats is
  'Ana paneldeki özet kartların kaynağı: ürün sayısı, toplam adet, envanter değeri, kritik ve tükenen stok, reyon sayısı.';

revoke all on public.inventory_stats from anon;
grant select on public.inventory_stats to authenticated;
