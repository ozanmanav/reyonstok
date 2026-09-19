import type { Metadata } from 'next';
import Link from 'next/link';
import CreateStaffForm from './CreateStaffForm';
import { setActiveAction, updateRoleAction } from './actions';
import { getCurrentUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ROLE_LABELS, type Profile, type UserRole } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Personel - ReyonStok',
};

/**
 * Personel yönetimi. Yalnızca yöneticiye açık.
 *
 * Yetki kontrolü hem burada hem eylemlerde yapılıyor: sayfanın gizlenmesi
 * yeterli değil, eylemler doğrudan da çağrılabilir.
 */
export default async function AdminUsersPage() {
  const supabase = await createSupabaseServerClient();
  const currentUser = await getCurrentUser(supabase);

  // Sayfayı gizlemek tek başına yeterli değil; eylemler de kendi yetki
  // kontrolünü yapıyor. Deneysel `forbidden()` yerine sade bir bilgi ekranı
  // gösteriyoruz.
  if (!currentUser || currentUser.profile.role !== 'admin') {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-black text-zinc-900">Bu sayfaya erişiminiz yok</h1>
        <p className="mt-1.5 text-sm text-zinc-600">
          Personel yönetimi yalnızca yöneticilere açıktır.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white"
        >
          Ana sayfaya dön
        </Link>
      </div>
    );
  }

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, created_at, updated_at')
    .order('created_at', { ascending: true });

  const profiles = (data ?? []) as Profile[];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">Personel</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Hesap açın, yetki seviyesini değiştirin veya ayrılan personeli devre dışı bırakın.
        </p>
      </div>

      <section
        aria-labelledby="yeni-personel"
        className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm"
      >
        <h2 id="yeni-personel" className="mb-3 text-sm font-black text-zinc-900">
          Yeni personel ekle
        </h2>
        <CreateStaffForm />
      </section>

      <section aria-labelledby="personel-listesi" className="space-y-2">
        <h2 id="personel-listesi" className="text-sm font-black text-zinc-900">
          Kayıtlı personel ({profiles.length})
        </h2>

        <ul className="space-y-2">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-zinc-900">
                      {profile.full_name.trim() || profile.email}
                    </span>
                    {profile.id === currentUser.id ? (
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">
                        siz
                      </span>
                    ) : null}
                    {!profile.is_active ? (
                      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        devre dışı
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">{profile.email}</div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <RoleSelect
                    userId={profile.id}
                    role={profile.role}
                    disabled={profile.id === currentUser.id}
                  />

                  {profile.id === currentUser.id ? null : (
                    <form action={setActiveAction}>
                      <input type="hidden" name="userId" value={profile.id} />
                      <input
                        type="hidden"
                        name="isActive"
                        value={profile.is_active ? 'false' : 'true'}
                      />
                      <button
                        type="submit"
                        className="rounded-xl border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 transition-colors hover:bg-zinc-100"
                      >
                        {profile.is_active ? 'Devre dışı bırak' : 'Etkinleştir'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * Rol değiştirme. Yönetici kendi rolünü düşüremez; aksi halde sistemde hiç
 * yönetici kalmayabilir.
 */
function RoleSelect({
  userId,
  role,
  disabled,
}: {
  userId: string;
  role: UserRole;
  disabled: boolean;
}) {
  const selectId = `role-${userId}`;

  return (
    <form action={updateRoleAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor={selectId} className="sr-only">
        Yetki seviyesi
      </label>
      <select
        id={selectId}
        name="role"
        defaultValue={role}
        disabled={disabled}
        className="rounded-xl border border-zinc-300 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-800 outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
      >
        {(Object.keys(ROLE_LABELS) as UserRole[]).map((value) => (
          <option key={value} value={value}>
            {ROLE_LABELS[value]}
          </option>
        ))}
      </select>
      {disabled ? null : (
        <button
          type="submit"
          className="rounded-xl border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          Kaydet
        </button>
      )}
    </form>
  );
}
