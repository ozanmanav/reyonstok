/**
 * Belirtilen rolde bir hesap açar (veya var olan hesabın rolünü günceller).
 *
 * Neden gerekli: veritabanı trigger'ı her yeni kullanıcıyı en kısıtlı rol olan
 * `viewer` ile açıyor. Dolayısıyla sistemde hiç yönetici yokken uygulama
 * içinden yönetici yaratmak mümkün değil; ilk yöneticiyi açacak bir yola
 * ihtiyaç var. Aynı betik test hesapları açmak için de kullanılıyor.
 *
 * Kullanım:
 *   node scripts/create-user.mjs <eposta> <sifre> [rol] [ad soyad]
 *
 * Örnekler:
 *   node scripts/create-user.mjs patron@magaza.com "guclu-sifre" admin "Ad Soyad"
 *   node scripts/create-user.mjs kasa@magaza.com "guclu-sifre" staff "Kasa"
 *
 * Rol verilmezse `admin` varsayılır.
 *
 * Ortam değişkenleri `.env.local` dosyasından okunur
 * (`vercel env pull .env.local`).
 *
 * UYARI: yönetim (service role) anahtarı kullanıyor, RLS'i tamamen aşar.
 * Yalnızca güvendiğiniz makinede çalıştırın.
 */
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.env.local');

const VALID_ROLES = ['admin', 'staff', 'viewer'];

const [email, password, role = 'admin', fullName = ''] = process.argv.slice(2);

if (!email || !password) {
  console.error('Kullanım: node scripts/create-user.mjs <eposta> <sifre> [rol] [ad soyad]');
  console.error(`Roller: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

if (!VALID_ROLES.includes(role)) {
  console.error(`Geçersiz rol: "${role}". Geçerli roller: ${VALID_ROLES.join(', ')}`);
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
    'NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli. `vercel env pull .env.local` çalıştırın.',
  );
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  // Doğrulama e-postası beklemeden giriş yapılabilsin: hesabı açan kişi zaten
  // yönetim anahtarına sahip.
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

  // Hesap varsa şifresini ve rolünü güncelliyoruz; betik tekrar
  // çalıştırılabilir olsun (şifre unutulduğunda da işe yarıyor).
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

  const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password });

  if (passwordError) {
    console.error('Şifre güncellenemedi:', passwordError.message);
    process.exit(1);
  }

  console.log('Hesap zaten vardı; şifresi ve rolü güncellendi.');
}

const { error: roleError } = await admin
  .from('profiles')
  .update({ role, is_active: true, ...(fullName ? { full_name: fullName } : {}) })
  .eq('id', userId);

if (roleError) {
  console.error('Rol atanamadı:', roleError.message);
  process.exit(1);
}

console.log(`Hazır: ${email} (${role})`);
