import type { Metadata } from 'next';
import LoginForm from './LoginForm';

export const metadata: Metadata = {
  title: 'Giriş - ReyonStok',
};

/**
 * Giriş sayfası.
 *
 * `next` parametresi, oturumu olmayan kullanıcı korumalı bir sayfaya gitmeye
 * çalıştığında proxy tarafından ekleniyor; giriş sonrası oraya dönülür.
 */
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : undefined;

  return (
    <div className="mx-auto w-full max-w-sm pt-6 sm:pt-16">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">ReyonStok</h1>
        <p className="mt-1 text-sm text-zinc-600">Mağaza karekod, fiyat ve stok takibi</p>
      </div>

      <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <LoginForm next={next} />
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
        Hesabınız yoksa mağaza yöneticisinden oluşturmasını isteyin.
      </p>
    </div>
  );
}
