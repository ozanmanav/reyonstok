'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ROLE_LABELS } from '@/lib/types';
import { createStaffAction, type UserActionState } from './actions';

/** Yeni personel hesabı açma formu. */
export default function CreateStaffForm() {
  const [state, formAction] = useActionState<UserActionState, FormData>(createStaffAction, {});

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800"
        >
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800"
        >
          {state.success}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ad soyad" name="full_name" autoComplete="name" />
        <Field label="E-posta" name="email" type="email" autoComplete="off" />
        <Field
          label="Geçici şifre"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="En az 8 karakter. Personel girişten sonra değiştirebilir."
        />

        <div className="space-y-1.5">
          <label htmlFor="role" className="block text-sm font-semibold text-zinc-700">
            Yetki
          </label>
          <select
            id="role"
            name="role"
            defaultValue="staff"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
          >
            <option value="staff">{ROLE_LABELS.staff} (stok ve fiyat güncelleyebilir)</option>
            <option value="viewer">{ROLE_LABELS.viewer} (yalnızca görüntüler)</option>
            <option value="admin">{ROLE_LABELS.admin} (her şey)</option>
          </select>
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-semibold text-zinc-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize={type === 'email' ? 'none' : undefined}
        aria-describedby={hintId}
        required
        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
      />
      {hint ? (
        <p id={hintId} className="text-xs text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-400"
    >
      {pending ? 'Oluşturuluyor...' : 'Personel ekle'}
    </button>
  );
}
