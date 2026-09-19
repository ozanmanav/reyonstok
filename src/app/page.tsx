import type { Metadata } from 'next';
import Link from 'next/link';
import {
  formatChange,
  formatCurrency,
  formatCurrencyCompact,
  formatQuantity,
  formatTime,
} from '@/lib/format';
import { getAllShelves, getInventoryStats } from '@/lib/repo/products';
import { getRecentStockLogs, type StockLogWithContext } from '@/lib/repo/stock-logs';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Ana panel - ReyonStok',
};

/**
 * Ana panel.
 *
 * Mağazada en sık yapılan iş tarama olduğu için sayfanın en üstünde tarama
 * butonu var. Altındaki özet kartlar günlük kontrol için: envanter değeri ve
 * kritik stok sayısı, dükkanı açarken bakılan iki sayı.
 *
 * Veriler tek seferde paralel çekiliyor; mağaza mobil bağlantısında sıralı üç
 * sorgu gözle görülür gecikme yaratıyor.
 */
export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  const [stats, shelves, logs] = await Promise.all([
    getInventoryStats(supabase),
    getAllShelves(supabase),
    getRecentStockLogs(supabase, 12),
  ]);

  const criticalCount = stats.low_stock_count + stats.out_of_stock_count;

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 p-5 text-white sm:p-7">
        <div className="relative z-10 max-w-xl">
          <h1 className="text-2xl font-black leading-tight tracking-tight sm:text-3xl">
            Reyon karekod ve stok yönetimi
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            Reyon etiketindeki karekodu telefonla okutun; fiyatı ve stoğu anında görün, tek
            dokunuşla düzeltin.
          </p>

          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/scan"
              className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-zinc-950 transition-transform active:scale-[0.98]"
            >
              Karekod tara
            </Link>
            <Link
              href="/print-labels"
              className="rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-bold text-white"
            >
              Reyon etiketi bas
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="ozet" className="space-y-2">
        <h2 id="ozet" className="sr-only">
          Envanter özeti
        </h2>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Kayıtlı ürün"
            value={formatQuantity(stats.total_products)}
            hint={`${formatQuantity(stats.shelves_count)} reyonda`}
          />
          <StatCard
            label="Toplam stok"
            value={formatQuantity(stats.total_stock_units)}
            hint="Mağazadaki toplam adet"
          />
          <StatCard
            label="Envanter değeri"
            value={formatCurrencyCompact(stats.total_inventory_value)}
            hint="Satış fiyatları toplamı"
            tone="money"
          />
          <StatCard
            label="Kritik stok"
            value={formatQuantity(criticalCount)}
            hint={`${formatQuantity(stats.out_of_stock_count)} tükendi, ${formatQuantity(
              stats.low_stock_count,
            )} azaldı`}
            tone={criticalCount > 0 ? 'warning' : undefined}
            href="/products?lowStock=true"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          aria-labelledby="reyonlar"
          className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-1"
        >
          <div className="mb-3 flex items-center justify-between border-b border-zinc-100 pb-2">
            <h2 id="reyonlar" className="text-sm font-black text-zinc-900">
              Reyonlar
            </h2>
            <Link href="/products" className="text-xs font-bold text-emerald-700">
              Tümü
            </Link>
          </div>

          {shelves.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-500">Henüz reyon tanımlanmadı.</p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {shelves.map((shelf) => (
                <li key={shelf}>
                  <Link
                    href={`/products?shelf=${encodeURIComponent(shelf)}`}
                    className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs font-semibold text-zinc-800 transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate">{shelf}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="hareketler"
          className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2"
        >
          <div className="mb-3 flex items-center justify-between border-b border-zinc-100 pb-2">
            <h2 id="hareketler" className="text-sm font-black text-zinc-900">
              Son stok ve fiyat hareketleri
            </h2>
          </div>

          {logs.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">
              Henüz bir hareket kaydedilmedi.
            </p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {logs.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Özet kartı. `href` verilirse tıklanabilir olur. */
function StatCard({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'money' | 'warning';
  href?: string;
}) {
  const valueColor =
    tone === 'money' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-600' : 'text-zinc-900';

  const surface =
    tone === 'warning' ? 'border-amber-200 bg-amber-50/70' : 'border-zinc-200 bg-white';

  const content = (
    <>
      <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-black tracking-tight sm:text-3xl ${valueColor}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium text-zinc-500">{hint}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`block rounded-2xl border p-4 shadow-sm transition-colors hover:border-emerald-300 ${surface}`}
      >
        {content}
      </Link>
    );
  }

  return <div className={`rounded-2xl border p-4 shadow-sm ${surface}`}>{content}</div>;
}

/** Tek bir hareket satırı. */
function LogRow({ log }: { log: StockLogWithContext }) {
  const isPriceChange = log.change_amount === 0;

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-bold text-zinc-900">
            {log.product?.name ?? 'Silinmiş ürün'}
          </span>
          {log.product?.shelf_location ? (
            <span className="shrink-0 truncate rounded bg-zinc-200/70 px-1.5 text-[10px] text-zinc-600">
              {log.product.shelf_location}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-zinc-500">
          {formatTime(log.created_at)}
          {' · '}
          {/* RLS gereği başkasının profili okunamıyor; ad yoksa nötr ifade. */}
          {log.user?.full_name?.trim() || 'Personel'}
        </p>
      </div>

      <div className="shrink-0 text-right">
        {isPriceChange ? (
          <span className="font-black text-emerald-700">
            {log.new_price === null ? '' : formatCurrency(log.new_price)}
          </span>
        ) : (
          <>
            <span
              className={`font-black ${
                log.change_amount > 0 ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {formatChange(log.change_amount)}
            </span>
            <span className="ml-1 text-[10px] text-zinc-400">
              ({log.old_stock}&rarr;{log.new_stock})
            </span>
          </>
        )}
      </div>
    </li>
  );
}
