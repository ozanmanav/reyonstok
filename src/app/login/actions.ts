'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Giriş ve çıkış işlemleri.
 *
 * Server Action kullanılıyor: form gönderimi çerez yazabiliyor ve Next.js
 * eylemlere karşı istek sahteciliği (CSRF) korumasını kendisi sağlıyor.
 */

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'E-posta adresi zorunlu')
    .pipe(z.string().email('Geçerli bir e-posta adresi girin')),
  password: z.string().min(1, 'Şifre zorunlu'),
});

export interface LoginState {
  error?: string;
}

/**
 * Yönlendirme hedefini doğrular.
 *
 * Yalnızca uygulama içi, tek eğik çizgiyle başlayan yollar kabul edilir;
 * aksi halde `?next=https://kotu-site` ile kullanıcı dışarıya yönlendirilebilir
 * (open redirect).
 */
function safeRedirectTarget(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }

  return value;
}

export async function signInAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Girilen bilgiler geçersiz' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Hangi alanın hatalı olduğunu söylemiyoruz: e-posta var mı yok mu bilgisi
    // saldırgana kullanıcı listesi çıkarma imkânı verir.
    return { error: 'E-posta veya şifre hatalı' };
  }

  redirect(safeRedirectTarget(formData.get('next') as string | null));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  redirect('/login');
}
