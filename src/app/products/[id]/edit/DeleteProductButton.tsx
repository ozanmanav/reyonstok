'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Ürün silme.
 *
 * İki adımlı onay var: silme geri alınamıyor ve ürünün hareket geçmişi de
 * gidiyor. Mağaza telefonunda yanlışlıkla dokunmak kolay olduğu için tek
 * tıklamayla silmek doğru olmaz.
 */
export default function DeleteProductButton({
  productId,
  productName,
}: {
  productId: number;
  productName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/products/${productId}`, { method: 'DELETE' });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? 'Ürün silinemedi');
      }

      router.push('/products');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ürün silinemedi');
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        {error ? (
          <p role="alert" className="text-xs font-semibold text-rose-800">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-bold text-rose-700"
        >
          Ürünü sil
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-rose-900">
        {productName} kalıcı olarak silinecek. Emin misiniz?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={pending}
          className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white disabled:bg-zinc-400"
        >
          {pending ? 'Siliniyor...' : 'Evet, sil'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}
