import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './api';
import type { Profile, UserRole } from './types';

/**
 * Oturum ve yetki kontrolleri.
 *
 * RLS politikaları veritabanı tarafında ikinci savunma hattı olarak duruyor;
 * buradaki kontroller ilk hattı oluşturur ve kullanıcıya doğru HTTP durum kodu
 * ile anlaşılır mesaj döndürülmesini sağlar.
 */

export interface CurrentUser {
  id: string;
  email: string | null;
  profile: Profile;
}

/**
 * Oturum sahibini ve profilini getirir.
 *
 * `getUser()` çerezdeki belirteci doğrulamak için kimlik sunucusuna gider;
 * `getSession()` yalnızca çereze güvendiği için yetki kararlarında kullanılmaz.
 *
 * @returns Oturum yoksa, profil satırı yoksa veya kullanıcı devre dışı
 * bırakılmışsa null.
 */
export async function getCurrentUser(supabase: SupabaseClient): Promise<CurrentUser | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return null;
  }

  const typedProfile = profile as Profile;

  // Devre dışı bırakılan personel giriş yapmış olsa da uygulamayı kullanamaz.
  if (!typedProfile.is_active) {
    return null;
  }

  return { id: user.id, email: user.email ?? null, profile: typedProfile };
}

/** Oturum zorunlu uçlarda kullanılır. */
export async function requireUser(supabase: SupabaseClient): Promise<CurrentUser> {
  const user = await getCurrentUser(supabase);

  if (!user) {
    throw new ApiError(401, 'Bu işlem için giriş yapmanız gerekiyor');
  }

  return user;
}

/**
 * Belirli rolleri zorunlu kılar.
 *
 * @param roles İzin verilen roller. Örn. yazma işlemleri için ['admin', 'staff'].
 */
export async function requireRole(
  supabase: SupabaseClient,
  roles: readonly UserRole[]
): Promise<CurrentUser> {
  const user = await requireUser(supabase);

  if (!roles.includes(user.profile.role)) {
    throw new ApiError(403, 'Bu işlem için yetkiniz yok');
  }

  return user;
}

/** Ürün ve stok yazma yetkisi olan roller. */
export const WRITE_ROLES: readonly UserRole[] = ['admin', 'staff'];

/** Yalnızca yöneticiye açık işlemler. */
export const ADMIN_ROLES: readonly UserRole[] = ['admin'];
