/**
 * İlk yönetici hesabını oluşturur.
 *
 * Neden gerekli: veritabanı trigger'ı her yeni kullanıcıyı en kısıtlı rol olan
 * `viewer` ile açıyor. Dolayısıyla sistemde hiç yönetici yokken uygulama
 * içinden yönetici yaratmak mümkün değil. Bu betik yönetim anahtarıyla hesabı
 * açıp rolünü admin'e çekiyor.
 *
 * Kullanım:
 *   node scripts/create-admin.mjs eposta@ornek.com "guclu-bir-sifre" "Ad Soyad"
 *
 * Ortam değişkenleri `.env.local` dosyasından okunur
 * (`vercel env pull .env.local`).
 */
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.env.local');

const [email, password, fullName = ''] = process.argv.slice(2);

if (!email || !password) {
  console.error('Kullanım: node scripts/create-admin.mjs <eposta> <sifre> [ad soyad]');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Şifre en az 8 karakter olmalı.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli. `vercel env pull .env.local` çalıştırın.'
  );
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});

let userId = created?.user?.id;

if (createError) {
  const alreadyExists = createError.message.toLowerCase().includes('already');

  if (!alreadyExists) {
    console.error('Hesap oluşturulamadı:', createError.message);
    process.exit(1);
  }

  // Hesap varsa yalnızca rolünü yükseltiyoruz; betik tekrar çalıştırılabilir olsun.
  const { data: existing, error: lookupError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (lookupError || !existing) {
    console.error('Mevcut hesap bulunamadı:', lookupError?.message ?? 'profil yok');
    process.exit(1);
  }

  userId = existing.id;
  console.log('Hesap zaten vardı, rolü yönetici olarak güncelleniyor.');
}

const { error: roleError } = await admin
  .from('profiles')
  .update({ role: 'admin', is_active: true, full_name: fullName || undefined })
  .eq('id', userId);

if (roleError) {
  console.error('Rol atanamadı:', roleError.message);
  process.exit(1);
}

console.log(`Yönetici hazır: ${email}`);
