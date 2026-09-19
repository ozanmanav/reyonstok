import type { SupabaseClient } from '@supabase/supabase-js';
import type { StockLog } from '@/lib/types';

/**
 * Stok ve fiyat hareketlerinin okunması.
 *
 * Kayıtlar yalnızca `adjust_stock_and_price` fonksiyonu ve ürün oluşturma akışı
 * tarafından yazılır; bu modül okuma tarafını sağlar. Veritabanında güncelleme
 * ve silme politikası tanımlı olmadığı için kayıtlar değiştirilemez.
 */

/** Listelerde hareketin yanında ürün ve kullanıcı bilgisini de göstermek için. */
export interface StockLogWithContext extends StockLog {
  product: {
    code: string;
    name: string;
    shelf_location: string;
    unit: string;
  } | null;
  user: {
    full_name: string;
  } | null;
}

const LOG_COLUMNS = `
  id, product_id, user_id, change_amount, old_stock, new_stock,
  old_price, new_price, type, note, created_at,
  product:products ( code, name, shelf_location, unit ),
  user:profiles ( full_name )
`;

/**
 * Ana paneldeki "son hareketler" listesi.
 *
 * Kullanıcı adı profiles tablosundan geliyor; RLS gereği personel yalnızca
 * kendi profilini okuyabildiği için başkasının yaptığı hareketlerde `user`
 * null döner. Arayüz bu durumda kullanıcı adı yerine nötr bir ifade gösterir.
 */
export async function getRecentStockLogs(
  supabase: SupabaseClient,
  limit = 20
): Promise<StockLogWithContext[]> {
  const { data, error } = await supabase
    .from('stock_logs')
    .select(LOG_COLUMNS)
    .order('id', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as StockLogWithContext[];
}

/** Ürün kartının altındaki "bu ürünün son hareketleri" listesi. */
export async function getStockLogsForProduct(
  supabase: SupabaseClient,
  productId: number,
  limit = 10
): Promise<StockLogWithContext[]> {
  const { data, error } = await supabase
    .from('stock_logs')
    .select(LOG_COLUMNS)
    .eq('product_id', productId)
    .order('id', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as StockLogWithContext[];
}
