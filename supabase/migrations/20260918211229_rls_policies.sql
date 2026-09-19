-- Satır seviyesi güvenlik (RLS) politikaları.
--
-- Uygulamadaki yetki kontrolü sunucu tarafındaki veri katmanında da yapılıyor;
-- buradaki politikalar ikinci savunma hattıdır. Tarayıcıya yalnızca publishable
-- (anon) anahtar indiği için, oturum açmış bir kullanıcı doğrudan API'ye istek
-- atsa bile bu politikaların dışına çıkamaz.

-- ---------------------------------------------------------------------------
-- Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------------

-- Oturum sahibinin rolünü döndürür. Devre dışı bırakılmış kullanıcı için NULL
-- döner, böylece tek kontrolle hem aktiflik hem rol doğrulanır.
--
-- security definer olması şart: politikalar profiles tablosunu okurken tekrar
-- profiles politikalarını tetiklerse sonsuz özyineleme oluşur.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = (select auth.uid())
     and p.is_active;
$$;

comment on function public.current_user_role() is
  'Oturum açmış ve aktif kullanıcının rolü; pasif veya oturumsuz durumda NULL.';

-- Ürün ve stok yazma yetkisi olan roller.
create or replace function public.current_user_can_write()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.current_user_role() in ('admin', 'staff');
$$;

-- Yalnızca yöneticiye açık işlemler (kullanıcı yönetimi, ürün silme).
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.current_user_role() = 'admin';
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Kullanıcı kendi profilini görür; yönetici herkesi görür.
create policy "profiles_select_self_or_admin"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.current_user_is_admin());

-- Kullanıcı yalnızca kendi görünen adını değiştirebilir. Rol ve aktiflik
-- alanlarının kendi kendine yükseltilmesi with check ile engelleniyor.
create policy "profiles_update_own_name"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
    and is_active = (select p.is_active from public.profiles p where p.id = (select auth.uid()))
  );

-- Yönetici rolleri ve aktifliği yönetir.
create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create policy "profiles_delete_admin"
  on public.profiles for delete
  to authenticated
  using (public.current_user_is_admin());

-- Insert politikası bilinçli olarak tanımlanmadı: profil satırları yalnızca
-- auth.users trigger'ı (security definer) tarafından açılır.

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;

-- Aktif olan her personel ürünleri görebilir (viewer dahil).
create policy "products_select_active_staff"
  on public.products for select
  to authenticated
  using (public.current_user_role() is not null);

create policy "products_insert_staff"
  on public.products for insert
  to authenticated
  with check (public.current_user_can_write());

create policy "products_update_staff"
  on public.products for update
  to authenticated
  using (public.current_user_can_write())
  with check (public.current_user_can_write());

-- Silme yalnızca yöneticide: yanlışlıkla ürün silinmesi geri alınamaz.
create policy "products_delete_admin"
  on public.products for delete
  to authenticated
  using (public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- stock_logs
-- ---------------------------------------------------------------------------

alter table public.stock_logs enable row level security;

create policy "stock_logs_select_active_staff"
  on public.stock_logs for select
  to authenticated
  using (public.current_user_role() is not null);

-- Kaydı yazan kullanıcı kendi kimliğini yazmak zorunda; başkasının adına
-- hareket kaydı oluşturulamaz.
create policy "stock_logs_insert_staff"
  on public.stock_logs for insert
  to authenticated
  with check (
    public.current_user_can_write()
    and user_id = (select auth.uid())
  );

-- update ve delete politikası yok: denetim kaydı değiştirilemez.
