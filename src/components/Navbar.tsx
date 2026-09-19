import Link from 'next/link';
import { signOutAction } from '@/app/login/actions';
import { ROLE_LABELS, type UserRole } from '@/lib/types';

/**
 * Üst gezinme çubuğu.
 *
 * Rol bilgisine göre bağlantıları gizler. Bu yalnızca arayüz kolaylığı:
 * yetkilendirme sunucu tarafında (requireRole) ve veritabanında (RLS)
 * uygulanıyor, buradaki gizleme güvenlik önlemi değil.
 */
export default function Navbar({
  fullName,
  email,
  role,
}: {
  fullName: string;
  email: string;
  role: UserRole;
}) {
  const displayName = fullName.trim() || email;

  return (
    // Gezinme çubuğu basılan etiket sayfasında yer kaplamamalı.
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur pt-safe print:hidden">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="shrink-0 text-base font-black tracking-tight text-zinc-900">
            ReyonStok
          </Link>

          <nav aria-label="Ana gezinme" className="hidden items-center gap-1 sm:flex">
            <NavLink href="/scan">Tara</NavLink>
            <NavLink href="/products">Ürünler</NavLink>
            <NavLink href="/print-labels">Etiket bas</NavLink>
            {role === 'admin' ? <NavLink href="/admin/users">Personel</NavLink> : null}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden text-right leading-tight sm:block">
            <div className="max-w-[12rem] truncate text-sm font-semibold text-zinc-900">
              {displayName}
            </div>
            <div className="text-[11px] font-medium text-zinc-500">{ROLE_LABELS[role]}</div>
          </div>

          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-xl border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 transition-colors hover:bg-zinc-100"
            >
              Çıkış
            </button>
          </form>
        </div>
      </div>

      {/* Mobilde gezinme bağlantıları alt satıra iner */}
      <nav
        aria-label="Ana gezinme (mobil)"
        className="flex items-center gap-1 overflow-x-auto border-t border-zinc-100 px-4 py-2 sm:hidden"
      >
        <NavLink href="/scan">Tara</NavLink>
        <NavLink href="/products">Ürünler</NavLink>
        <NavLink href="/print-labels">Etiket bas</NavLink>
        {role === 'admin' ? <NavLink href="/admin/users">Personel</NavLink> : null}
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
    >
      {children}
    </Link>
  );
}
