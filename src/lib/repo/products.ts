import type { SupabaseClient } from '@supabase/supabase-js';
import { nextProductCode, normalizeScan } from '@/lib/scan-code';
import type { InventoryStats, Product } from '@/lib/types';

/**
 * Ürün veri erişim katmanı.
 *
 * Tüm fonksiyonlar Supabase istemcisini parametre olarak alır. Böylece aynı kod
 * hem kullanıcı oturumuyla (RLS uygulanır) hem de testlerde yönetim anahtarıyla
 * çalıştırılabilir; istemciyi içeride oluşturmak bu esnekliği kaybettirirdi.
 *
 * Katman veritabanı hatalarını olduğu gibi yukarı taşır (throw); HTTP'ye çeviren
 * yer route handler'lardır.
 */

/** Ürün listesini daraltmak için kullanılan filtreler. */
export interface ProductFilters {
  /** Ürün adı, kodu, barkodu veya reyon adında geçen metin. */
  search?: string;
  shelf?: string;
  category?: string;
  /** Yalnızca stoğu kritik eşiğin altına düşmüş ürünler. */
  lowStock?: boolean;
  limit?: number;
}

/** Yeni ürün kaydı. `code` verilmezse sıradaki kod otomatik üretilir. */
export interface CreateProductInput {
  code?: string;
  barcode?: string | null;
  name: string;
  category?: string;
  shelf_location: string;
  cost_price?: number;
  sale_price: number;
  stock_quantity?: number;
  min_stock_alert?: number;
  unit?: string;
  notes?: string;
}

export type UpdateProductInput = Partial<Omit<CreateProductInput, 'code'>> & {
  code?: string;
};

const PRODUCT_COLUMNS =
  'id, code, barcode, name, category, shelf_location, cost_price, sale_price, stock_quantity, min_stock_alert, is_low_stock, unit, notes, created_at, updated_at';

/**
 * Filtrelere uyan ürünleri reyon ve ada göre sıralı döndürür.
 *
 * Kritik stok filtresi veritabanında iki kolonu karşılaştırmayı gerektirdiği
 * için PostgREST'in kolon karşılaştırma söz dizimi kullanılıyor.
 */
export async function getAllProducts(
  supabase: SupabaseClient,
  filters: ProductFilters = {},
): Promise<Product[]> {
  let query = supabase.from('products').select(PRODUCT_COLUMNS);

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    query = query.or(
      [
        `name.ilike.${pattern}`,
        `code.ilike.${pattern}`,
        `barcode.ilike.${pattern}`,
        `shelf_location.ilike.${pattern}`,
      ].join(','),
    );
  }

  if (filters.shelf) {
    query = query.eq('shelf_location', filters.shelf);
  }

  if (filters.category) {
    query = query.eq('category', filters.category);
  }

  if (filters.lowStock) {
    // Koşul (stock_quantity <= min_stock_alert) veritabanında üretilmiş kolona
    // taşındı; PostgREST kolonu başka bir kolonla karşılaştıramıyor.
    query = query.eq('is_low_stock', true);
  }

  query = query.order('shelf_location', { ascending: true }).order('name', { ascending: true });

  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data ?? []) as Product[];
}

export async function getProductById(
  supabase: SupabaseClient,
  id: number,
): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Product | null) ?? null;
}

/**
 * Taranan değerden ürünü bulur.
 *
 * Gelen değer ham tarama çıktısı olabilir: ürün kodu, EAN-13 barkod veya
 * etiketteki `https://.../scan?code=...` adresi. Çözümlemeyi normalizeScan
 * yapar; burada yalnızca hangi kolonda aranacağına karar veriyoruz.
 *
 * Karekod okunduysa ürün kodunda, diğer durumlarda barkodda aranır. Barkodda
 * bulunamazsa ürün kodu da denenir: personel barkod alanına ürün kodunu elle
 * yazmış olabilir.
 */
export async function getProductByCode(
  supabase: SupabaseClient,
  rawCode: string,
): Promise<Product | null> {
  const scan = normalizeScan(rawCode);

  // Kullanılabilir bir değer çıkmadıysa veritabanına hiç gitmeyelim.
  if (scan.code === '') {
    return null;
  }

  if (scan.kind === 'qr') {
    return findByColumn(supabase, 'code', scan.code);
  }

  const byBarcode = await findByColumn(supabase, 'barcode', scan.code);
  if (byBarcode) {
    return byBarcode;
  }

  return findByColumn(supabase, 'code', scan.code.toUpperCase());
}

async function findByColumn(
  supabase: SupabaseClient,
  column: 'code' | 'barcode',
  value: string,
): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq(column, value)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Product | null) ?? null;
}

/**
 * Sıradaki ürün kodunu üretir.
 *
 * Kodlar metin olduğu için sayısal sıralama yerine en büyük kodu bulmak
 * gerekiyor; ENV-9999 ile ENV-10000 karşılaştırmasında metin sıralaması yanlış
 * sonuç verdiğinden uzunluk önce, sonra alfabetik sıralama kullanılıyor.
 */
export async function getNextProductCode(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.from('products').select('code').like('code', 'ENV-%');

  if (error) {
    throw error;
  }

  const codes = ((data ?? []) as { code: string }[]).map((row) => row.code);
  if (codes.length === 0) {
    return nextProductCode();
  }

  const highest = codes.reduce((best, current) => {
    if (current.length !== best.length) {
      return current.length > best.length ? current : best;
    }

    return current > best ? current : best;
  });

  return nextProductCode(highest);
}

/**
 * Yeni ürün kaydeder ve başlangıç stoğunu denetim kaydına yazar.
 *
 * Hareket kaydı ayrı bir istek olduğu için ürün oluşup log yazılamayabilir;
 * bu durumda ürün kaydı korunur, log hatası yukarı taşınır. Ürünü silip
 * geri almak, sessizce log kaybetmekten daha kötü bir sonuç doğururdu.
 */
export async function createProduct(
  supabase: SupabaseClient,
  input: CreateProductInput,
  userId: string | null,
): Promise<Product> {
  const code = input.code?.trim()
    ? input.code.trim().toUpperCase()
    : await getNextProductCode(supabase);

  const row = {
    code,
    barcode: normalizeOptionalText(input.barcode),
    name: input.name.trim(),
    category: input.category?.trim() || 'Genel',
    shelf_location: input.shelf_location.trim(),
    cost_price: input.cost_price ?? 0,
    sale_price: input.sale_price,
    stock_quantity: input.stock_quantity ?? 0,
    min_stock_alert: input.min_stock_alert ?? 3,
    unit: input.unit?.trim() || 'Adet',
    notes: input.notes?.trim() ?? '',
  };

  const { data, error } = await supabase
    .from('products')
    .insert(row)
    .select(PRODUCT_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  const product = data as Product;

  const { error: logError } = await supabase.from('stock_logs').insert({
    product_id: product.id,
    user_id: userId,
    change_amount: product.stock_quantity,
    old_stock: 0,
    new_stock: product.stock_quantity,
    old_price: product.sale_price,
    new_price: product.sale_price,
    type: 'initial_count',
    note: 'Yeni ürün kaydı',
  });

  if (logError) {
    throw logError;
  }

  return product;
}

export async function updateProduct(
  supabase: SupabaseClient,
  id: number,
  patch: UpdateProductInput,
): Promise<Product | null> {
  const row: Record<string, unknown> = {};

  if (patch.code !== undefined) row.code = patch.code.trim().toUpperCase();
  if (patch.barcode !== undefined) row.barcode = normalizeOptionalText(patch.barcode);
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.category !== undefined) row.category = patch.category.trim() || 'Genel';
  if (patch.shelf_location !== undefined) row.shelf_location = patch.shelf_location.trim();
  if (patch.cost_price !== undefined) row.cost_price = patch.cost_price;
  if (patch.sale_price !== undefined) row.sale_price = patch.sale_price;
  if (patch.stock_quantity !== undefined) row.stock_quantity = patch.stock_quantity;
  if (patch.min_stock_alert !== undefined) row.min_stock_alert = patch.min_stock_alert;
  if (patch.unit !== undefined) row.unit = patch.unit.trim() || 'Adet';
  if (patch.notes !== undefined) row.notes = patch.notes.trim();

  if (Object.keys(row).length === 0) {
    return getProductById(supabase, id);
  }

  const { data, error } = await supabase
    .from('products')
    .update(row)
    .eq('id', id)
    .select(PRODUCT_COLUMNS)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Product | null) ?? null;
}

/**
 * Ürünü siler.
 *
 * @returns Silinen satır varsa true. RLS engellediğinde veya ürün yoksa false;
 * ikisi birbirinden ayırt edilmez, çağıran taraf yetkiyi önceden kontrol eder.
 */
export async function deleteProduct(supabase: SupabaseClient, id: number): Promise<boolean> {
  const { data, error } = await supabase.from('products').delete().eq('id', id).select('id');

  if (error) {
    throw error;
  }

  return (data ?? []).length > 0;
}

export interface AdjustStockInput {
  productId: number;
  /** Göreli değişim: -1, +1, +5. */
  stockDelta?: number;
  /** Sayımda bulunan kesin adet. */
  absoluteStock?: number;
  newSalePrice?: number;
  note?: string;
}

/**
 * Stok ve/veya fiyatı tek işlemde güncelleyip hareket kaydını yazar.
 *
 * Hesap veritabanı fonksiyonu içinde yapılır; uygulamada oku-değiştir-yaz
 * yapılsaydı aynı ürünü aynı anda güncelleyen iki personelden birinin işlemi
 * kaybolurdu.
 */
export async function adjustStockAndPrice(
  supabase: SupabaseClient,
  input: AdjustStockInput,
): Promise<Product> {
  const { data, error } = await supabase.rpc('adjust_stock_and_price', {
    p_product_id: input.productId,
    p_stock_delta: input.stockDelta ?? null,
    p_absolute_stock: input.absoluteStock ?? null,
    p_new_sale_price: input.newSalePrice ?? null,
    p_note: input.note ?? '',
  });

  if (error) {
    throw error;
  }

  return data as Product;
}

export async function getAllShelves(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('products')
    .select('shelf_location')
    .order('shelf_location', { ascending: true });

  if (error) {
    throw error;
  }

  return unique(((data ?? []) as { shelf_location: string }[]).map((row) => row.shelf_location));
}

export async function getAllCategories(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('products')
    .select('category')
    .order('category', { ascending: true });

  if (error) {
    throw error;
  }

  return unique(((data ?? []) as { category: string }[]).map((row) => row.category));
}

/**
 * Ana panelin özet kartları.
 *
 * Hiç ürün yokken görünüm tek satır döndürür (sayılar sıfır), bu yüzden
 * maybeSingle yeterli; yine de beklenmedik boş sonuçta sıfırlarla devam edilir.
 */
export async function getInventoryStats(supabase: SupabaseClient): Promise<InventoryStats> {
  const { data, error } = await supabase.from('inventory_stats').select('*').maybeSingle();

  if (error) {
    throw error;
  }

  return (
    (data as InventoryStats | null) ?? {
      total_products: 0,
      total_stock_units: 0,
      total_inventory_value: 0,
      low_stock_count: 0,
      out_of_stock_count: 0,
      shelves_count: 0,
    }
  );
}

/** Boş metni null'a çevirir; barkod alanı boş dize yerine null saklanmalı. */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

/**
 * PostgREST `or` filtresinde kullanıcı metni doğrudan sorguya giriyor; joker
 * karakterleri ve ayırıcıları kaçışlamak gerekiyor.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`).replace(/[,()]/g, ' ');
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}
