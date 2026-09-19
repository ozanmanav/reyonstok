import QrBadge from './QrBadge';
import { formatPrice, formatShortDate } from '@/lib/format';
import type { Product } from '@/lib/types';

/**
 * Rafa yapıştırılan tek bir reyon etiketi.
 *
 * Etiket iki kitleye hizmet ediyor: müşteri fiyatı uzaktan okuyor, personel
 * karekodu telefonla okutuyor. Bu yüzden fiyat etiketin en büyük öğesi, karekod
 * ise okutulabilecek kadar büyük ve ürün kodu karekodun altına metin olarak
 * yazılıyor (karekod okunamazsa personel kodu elle arayabilir).
 *
 * Stok adedi bilinçli olarak basılmıyor: basıldığı anda eskiyor ve raftaki
 * kağıda bakan kişiyi yanıltır; stok her zaman uygulamadan okunmalı. Basım
 * tarihi ise yazılıyor, personel etiketin ne kadar eski olduğunu görebilsin.
 *
 * Fiziksel ölçüler `globals.css` içindeki `@media print` bloğunda milimetre
 * cinsinden veriliyor; buradaki Tailwind ölçüleri ekran önizlemesi için.
 * Renkler koyu gri/siyah: tarayıcılar baskıda arka plan renklerini varsayılan
 * olarak atlıyor, okunabilirlik zemin rengine bırakılamaz.
 */
export default function ShelfTag({ product, qrSvg }: { product: Product; qrSvg: string }) {
  return (
    <article className="label-tag flex h-full flex-col justify-between gap-2 rounded-lg border border-zinc-400 bg-white p-2.5">
      <header className="min-w-0">
        <p className="label-tag__shelf truncate text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {product.shelf_location}
        </p>
        <h3 className="label-tag__name mt-0.5 line-clamp-2 text-[13px] font-black leading-tight text-zinc-900">
          {product.name}
        </h3>
      </header>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="label-tag__price text-[26px] font-black leading-none tracking-tight text-zinc-900">
            {formatPrice(product.sale_price)}
            <span className="label-tag__currency ml-0.5 text-base font-bold">₺</span>
          </p>
          <p className="label-tag__meta mt-1 text-[9px] font-semibold text-zinc-500">
            {product.unit}
            {' · '}
            {formatShortDate(product.updated_at)}
          </p>
        </div>

        <div className="shrink-0 text-center">
          <QrBadge
            svg={qrSvg}
            label={`${product.name} ürün karekodu`}
            className="label-tag__qr mx-auto h-[72px] w-[72px]"
          />
          <p className="label-tag__code mt-0.5 font-mono text-[8px] font-bold leading-none text-zinc-700">
            {product.code}
          </p>
        </div>
      </div>
    </article>
  );
}
