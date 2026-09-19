'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Personel yönetimi eylemleri. Hepsi yönetici yetkisi ister.
 *
 * Hesap açma ve silme Supabase Auth yönetim API'sini gerektirdiği için yönetim
 * anahtarıyla yapılır; rol ve aktiflik güncellemeleri ise kullanıcının kendi
 * oturumuyla yapılır, böylece RLS politikaları da devrede kalır.
 */

export interface UserActionState {
  error?: string;
  success?: string;
}

const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'E-posta adresi zorunlu')
    .pipe(z.string().email('Geçerli bir e-posta adresi girin')),
  // Supabase projesindeki asgari uzunlukla uyumlu tutuluyor.
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
  full_name: z.string().trim().min(1, 'Ad soyad zorunlu').max(120, 'Ad soyad çok uzun'),
  role: z.enum(['admin', 'staff', 'viewer']),
});

const roleSchema = z.object({
  userId: z.string().uuid('Geçersiz kullanıcı'),
  role: z.enum(['admin', 'staff', 'viewer']),
});

const activeSchema = z.object({
  userId: z.string().uuid('Geçersiz kullanıcı'),
  isActive: z.boolean(),
});

/** Yeni personel hesabı açar ve rolünü belirler. */
export async function createStaffAction(
  _previousState: UserActionState,
  formData: FormData
): Promise<UserActionState> {
  const supabase = await createSupabaseServerClient();
  await requireRole(supabase, ADMIN_ROLES);

  const parsed = createUserSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    full_name: formData.get('full_name'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Girilen bilgiler geçersiz' };
  }

  const admin = createSupabaseAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    // Mağaza içi hesaplarda e-posta doğrulama adımı beklemek gereksiz sürtünme.
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? '';
    const isDuplicate = message.toLowerCase().includes('already');

    return {
      error: isDuplicate
        ? 'Bu e-posta adresiyle bir hesap zaten var'
        : 'Hesap oluşturulamadı, bilgileri kontrol edin',
    };
  }

  // Trigger profili viewer olarak açtı; istenen rolü uygula.
  if (parsed.data.role !== 'viewer') {
    const { error: roleError } = await supabase
      .from('profiles')
      .update({ role: parsed.data.role })
      .eq('id', created.user.id);

    if (roleError) {
      return {
        error: 'Hesap açıldı ancak rol atanamadı, listeden rolü güncelleyin',
      };
    }
  }

  revalidatePath('/admin/users');

  return { success: `${parsed.data.full_name} için hesap oluşturuldu` };
}

/** Personelin rolünü değiştirir. */
export async function updateRoleAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const currentUser = await requireRole(supabase, ADMIN_ROLES);

  const parsed = roleSchema.parse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });

  // Yöneticinin kendi yetkisini düşürüp sistemi yönetilemez hale getirmesini
  // engelliyoruz; başka bir yöneticiyi düşürmek serbest.
  if (parsed.userId === currentUser.id && parsed.role !== 'admin') {
    return;
  }

  await supabase.from('profiles').update({ role: parsed.role }).eq('id', parsed.userId);

  revalidatePath('/admin/users');
}

/** Personeli devre dışı bırakır veya tekrar etkinleştirir. */
export async function setActiveAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const currentUser = await requireRole(supabase, ADMIN_ROLES);

  const parsed = activeSchema.parse({
    userId: formData.get('userId'),
    isActive: formData.get('isActive') === 'true',
  });

  // Kendini devre dışı bırakmak, uygulamadan tamamen kilitlenmek demek.
  if (parsed.userId === currentUser.id) {
    return;
  }

  await supabase
    .from('profiles')
    .update({ is_active: parsed.isActive })
    .eq('id', parsed.userId);

  revalidatePath('/admin/users');
}
