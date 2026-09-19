'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { signInAction, type LoginState } from './actions';

/**
 * Giriş formu.
 *
 * `useActionState` ile sunucudan dönen hata mesajı formun üstünde gösterilir;
 * başarılı girişte eylem yönlendirme yaptığı için burada başarı durumu yok.
 */
export default function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(signInAction, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold text-rose-800"
        >
          {state.error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-semibold text-zinc-700">
          E-posta
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          required
          className="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-3 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-semibold text-zinc-700">
          Şifre
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-3 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
        />
      </div>

      <SubmitButton />
    </form>
  );
}

/**
 * Gönderim sırasında butonu kilitler. `useFormStatus` yalnızca form içindeki
 * alt bileşenlerde çalıştığı için ayrı bileşene çıkarıldı.
 */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-bold text-white transition-colors hover:bg-emerald-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-zinc-400"
    >
      {pending ? 'Giriş yapılıyor...' : 'Giriş yap'}
    </button>
  );
}
