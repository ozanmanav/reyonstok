-- Profillere e-posta alanı.
--
-- Neden gerekli: yönetici ekranında personeli e-postasıyla listelemek gerekiyor,
-- ama auth.users tablosu Data API üzerinden okunamaz (yalnızca service role ile
-- erişilebilir). E-postayı profiles tablosuna kopyalayınca yönetici ekranı
-- normal RLS politikalarıyla, yönetim anahtarına ihtiyaç duymadan çalışıyor.

alter table public.profiles add column email text not null default '';

comment on column public.profiles.email is
  'Personelin giriş e-postası. auth.users tablosundan trigger ile kopyalanır, elle düzenlenmez.';

-- Mevcut kullanıcılar için doldur.
update public.profiles p
   set email = coalesce(u.email, '')
  from auth.users u
 where u.id = p.id;

-- Yeni kullanıcı açılırken e-posta da yazılsın.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Kullanıcı e-postasını değiştirdiğinde profil de güncellensin, aksi halde
-- yönetici ekranı eski adresi gösterir.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = coalesce(new.email, '')
   where id = new.id;

  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();
