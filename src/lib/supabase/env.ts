/**
 * Supabase bağlantı bilgilerinin tek okuma noktası.
 *
 * Değişkenler Vercel'deki Supabase entegrasyonu tarafından otomatik olarak
 * senkronlanıyor; yerelde `vercel env pull .env.local` ile geliyorlar. Eksik
 * değişkende anlaşılır hata vermek, üretimde sessiz başarısızlıktan iyidir.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} ortam değişkeni tanımlı değil. Yerelde \`vercel env pull .env.local\` çalıştırın.`
    );
  }

  return value;
}

/** Projenin genel API adresi. Tarayıcıya gönderilir. */
export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Herkese açık (publishable/anon) anahtar. Tarayıcıya inmesi normaldir; erişimi
 * RLS politikaları sınırlar.
 */
export function supabaseAnonKey(): string {
  return required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/**
 * RLS'i tamamen aşan yönetim anahtarı. Yalnızca sunucu tarafında, personel
 * davet etme gibi işlemler için kullanılır; istemci paketine asla girmemeli.
 */
export function supabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}
