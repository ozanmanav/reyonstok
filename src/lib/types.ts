/**
 * Uygulama genelinde kullanılan veri tipleri. Alan adları ve tipleri Postgres
 * şemasıyla birebir aynı tutuluyor (supabase/migrations), böylece veritabanından
 * gelen satırlar dönüştürülmeden kullanılabiliyor.
 */

/**
 * Personel yetki seviyeleri.
 *  - admin  : her şey + kullanıcı yönetimi + ürün silme
 *  - staff  : ürün ekleme/düzenleme + stok ve fiyat güncelleme
 *  - viewer : yalnızca görüntüleme
 */
export type UserRole = 'admin' | 'staff' | 'viewer';

/** Stok hareketinin sebebi. */
export type StockLogType =
  | 'initial_count'
  | 'stock_adjustment'
  | 'price_update'
  | 'scan_action'
  | 'import';

export interface Profile {
  id: string;
  full_name: string;
  /** Giriş e-postası. auth.users tablosundan trigger ile kopyalanır. */
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Rol adlarının arayüzde gösterilen Türkçe karşılıkları. */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Yönetici',
  staff: 'Personel',
  viewer: 'Görüntüleyici',
};

export interface Product {
  id: number;
  /** Reyon etiketindeki karekodun işaret ettiği ürün kodu (ENV-1001), her zaman büyük harf. */
  code: string;
  /** Üreticinin barkodu (çoğunlukla EAN-13). Ürünün barkodu yoksa null. */
  barcode: string | null;
  name: string;
  category: string;
  shelf_location: string;
  cost_price: number;
  sale_price: number;
  stock_quantity: number;
  min_stock_alert: number;
  /**
   * Stok kritik eşiğe düştü mü. Veritabanında üretilen kolon, elle yazılamaz;
   * `stock_quantity <= min_stock_alert` koşulunun karşılığı.
   */
  is_low_stock: boolean;
  unit: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface StockLog {
  id: number;
  product_id: number;
  /** Değişikliği yapan personel; kullanıcı silinmişse null. */
  user_id: string | null;
  change_amount: number;
  old_stock: number;
  new_stock: number;
  old_price: number | null;
  new_price: number | null;
  type: StockLogType;
  note: string;
  created_at: string;
}

/** Ana paneldeki özet kartların kaynağı (inventory_stats görünümü). */
export interface InventoryStats {
  total_products: number;
  total_stock_units: number;
  total_inventory_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
  shelves_count: number;
}
