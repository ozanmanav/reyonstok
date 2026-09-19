import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportedProduct } from '@/lib/product-import';
import { nextProductCode } from '@/lib/scan-code';
import type { Product } from '@/lib/types';
import { getNextProductCode } from './products';

/**
 * CSV ile gelen ürünlerin toplu kaydı.
 *
 * Eşleştirme ürün kodu üzerinden: kod varsa mevcut kayıt güncellenir, yoksa
 * yeni kayıt açılır. Kodsuz satırlara sıradaki kodlar verilir.
 *
 * Her satır denetim kaydına yazılır: yeni ürünler `initial_count`, güncellenen
 * ürünler `import` türüyle. Böylece "dün 500 ürün içe aktarıldı, fiyatlar
 * nereden değişti" sorusu cevaplanabilir kalıyor.
 */

const CHUNK_SIZE = 200;

export interface ImportFailure {
  code: string;
  name: string;
  message: string;
}

export interface ImportResult {
  inserted: number;
  updated: number;
  failures: ImportFailure[];
}

interface PreparedRow {
  code: string;
  payload: Record<string, unknown>;
  source: ImportedProduct;
}

/**
 * Ürünleri veritabanına yazar.
 *
 * @param userId Hareket kayıtlarına yazılacak kullanıcı kimliği.
 */
export async function importProducts(
  supabase: SupabaseClient,
  products: ImportedProduct[],
  userId: string,
): Promise<ImportResult> {
  if (products.length === 0) {
    return { inserted: 0, updated: 0, failures: [] };
  }

  const prepared = await prepareRows(supabase, products);
  const existing = await fetchExistingByCode(
    supabase,
    prepared.map((row) => row.code),
  );

  const result: ImportResult = { inserted: 0, updated: 0, failures: [] };

  for (let start = 0; start < prepared.length; start += CHUNK_SIZE) {
    const chunk = prepared.slice(start, start + CHUNK_SIZE);
    const written = await writeChunk(supabase, chunk, result);

    await writeLogs(supabase, written, existing, userId);
  }

  for (const row of prepared) {
    if (result.failures.some((failure) => failure.code === row.code)) {
      continue;
    }

    if (existing.has(row.code)) {
      result.updated += 1;
    } else {
      result.inserted += 1;
    }
  }

  return result;
}

/** Kodsuz satırlara sıradaki kodları verir. */
async function prepareRows(
  supabase: SupabaseClient,
  products: ImportedProduct[],
): Promise<PreparedRow[]> {
  // Kodsuz satır varsa numaralandırmayı mevcut en büyük koddan sürdürüyoruz.
  let runningCode = products.some((product) => !product.code)
    ? await getNextProductCode(supabase)
    : '';

  return products.map((product) => {
    let code = product.code;

    if (!code) {
      code = runningCode;
      runningCode = nextProductCode(runningCode);
    }

    const payload: Record<string, unknown> = {
      code,
      barcode: product.barcode,
      name: product.name,
      shelf_location: product.shelf_location,
      sale_price: product.sale_price,
    };

    // Verilmeyen alanlar üzerine yazılmasın: mevcut üründe dolu olan kategori
    // veya birimi boş CSV kolonu yüzünden kaybetmek istemiyoruz.
    if (product.category !== undefined) payload.category = product.category;
    if (product.cost_price !== undefined) payload.cost_price = product.cost_price;
    if (product.stock_quantity !== undefined) payload.stock_quantity = product.stock_quantity;
    if (product.min_stock_alert !== undefined) payload.min_stock_alert = product.min_stock_alert;
    if (product.unit !== undefined) payload.unit = product.unit;
    if (product.notes !== undefined) payload.notes = product.notes;

    return { code, payload, source: product };
  });
}

/** İçe aktarılacak kodların mevcut kayıtlarını getirir. */
async function fetchExistingByCode(
  supabase: SupabaseClient,
  codes: string[],
): Promise<Map<string, Product>> {
  const map = new Map<string, Product>();

  for (let start = 0; start < codes.length; start += CHUNK_SIZE) {
    const chunk = codes.slice(start, start + CHUNK_SIZE);

    const { data, error } = await supabase
      .from('products')
      .select('id, code, stock_quantity, sale_price')
      .in('code', chunk);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as Product[]) {
      map.set(row.code, row);
    }
  }

  return map;
}

/**
 * Bir grubu yazar.
 *
 * Önce toplu upsert denenir. Tek bir satır (örneğin başka bir üründe kayıtlı
 * barkod) grubu düşürürse satır satır tekrar denenir; böylece hatalı satır
 * yalıtılıp raporlanır, geri kalan ürünler aktarılır.
 */
async function writeChunk(
  supabase: SupabaseClient,
  chunk: PreparedRow[],
  result: ImportResult,
): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .upsert(
      chunk.map((row) => row.payload),
      { onConflict: 'code' },
    )
    .select('id, code, stock_quantity, sale_price');

  if (!error) {
    return (data ?? []) as Product[];
  }

  const written: Product[] = [];

  for (const row of chunk) {
    const single = await supabase
      .from('products')
      .upsert([row.payload], { onConflict: 'code' })
      .select('id, code, stock_quantity, sale_price')
      .single();

    if (single.error) {
      result.failures.push({
        code: row.code,
        name: row.source.name,
        message: describeWriteError(single.error),
      });
      continue;
    }

    written.push(single.data as Product);
  }

  return written;
}

/** Veritabanı hatasını kullanıcıya gösterilebilir bir cümleye çevirir. */
function describeWriteError(error: { code?: string; message?: string }): string {
  if (error.code === '23505') {
    return (error.message ?? '').includes('barcode')
      ? 'Bu barkod başka bir üründe kayıtlı'
      : 'Bu ürün kodu başka bir üründe kayıtlı';
  }

  if (error.code === '42501') {
    return 'Bu işlem için yetkiniz yok';
  }

  return error.message ?? 'Kaydedilemedi';
}

/** stock_logs tablosuna yazılacak satır. */
interface StockLogInsert {
  product_id: number;
  user_id: string;
  change_amount: number;
  old_stock: number;
  new_stock: number;
  old_price: number;
  new_price: number;
  type: 'initial_count' | 'import';
  note: string;
}

/** Yazılan satırlar için denetim kayıtlarını oluşturur. */
async function writeLogs(
  supabase: SupabaseClient,
  written: Product[],
  existing: Map<string, Product>,
  userId: string,
): Promise<void> {
  const logs = written.flatMap<StockLogInsert>((product) => {
    const before = existing.get(product.code);

    if (!before) {
      return [
        {
          product_id: product.id,
          user_id: userId,
          change_amount: product.stock_quantity,
          old_stock: 0,
          new_stock: product.stock_quantity,
          old_price: product.sale_price,
          new_price: product.sale_price,
          type: 'initial_count',
          note: 'CSV içe aktarma ile eklendi',
        },
      ];
    }

    // Hiçbir şey değişmediyse kayıt yazmayalım: içe aktarma denetim günlüğünü
    // gereksiz satırla şişirmesin.
    if (
      before.stock_quantity === product.stock_quantity &&
      before.sale_price === product.sale_price
    ) {
      return [];
    }

    return [
      {
        product_id: product.id,
        user_id: userId,
        change_amount: product.stock_quantity - before.stock_quantity,
        old_stock: before.stock_quantity,
        new_stock: product.stock_quantity,
        old_price: before.sale_price,
        new_price: product.sale_price,
        type: 'import',
        note: 'CSV içe aktarma ile güncellendi',
      },
    ];
  });

  if (logs.length === 0) {
    return;
  }

  const { error } = await supabase.from('stock_logs').insert(logs);
  if (error) {
    throw error;
  }
}
