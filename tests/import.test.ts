// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { importProducts } from '@/lib/repo/import';
import { getProductByCode } from '@/lib/repo/products';
import { getStockLogsForProduct } from '@/lib/repo/stock-logs';
import type { ImportedProduct } from '@/lib/product-import';
import {
  createAdminClient,
  createTestUser,
  deleteProducts,
  deleteTestUser,
  uniqueProductCode,
  type TestUser,
} from './helpers/supabase';

/**
 * Toplu içe aktarmanın gerçek veritabanına karşı doğrulanması.
 *
 * Dikkat edilen noktalar: mevcut ürünün güncellenmesi, kodsuz satırlara kod
 * verilmesi, çakışan barkodun tek satırı düşürüp diğerlerini engellememesi ve
 * her satırın denetim kaydına yazılması.
 */

const admin = createAdminClient();
const createdProductIds: number[] = [];
const createdCodes: string[] = [];

let staffUser: TestUser;

beforeAll(async () => {
  staffUser = await createTestUser('staff');
}, 60_000);

afterAll(async () => {
  // Kod üzerinden açılan ürünleri de temizle.
  if (createdCodes.length > 0) {
    const { data } = await admin.from('products').select('id').in('code', createdCodes);
    for (const row of (data ?? []) as { id: number }[]) {
      createdProductIds.push(row.id);
    }
  }

  await deleteProducts(createdProductIds);

  if (staffUser) {
    await deleteTestUser(staffUser);
  }
});

/** Testte kullanılacak ürün kodu üretir ve temizlik listesine ekler. */
function trackedCode(): string {
  const code = uniqueProductCode();
  createdCodes.push(code);

  return code;
}

function product(overrides: Partial<ImportedProduct> = {}): ImportedProduct {
  return {
    code: trackedCode(),
    barcode: null,
    name: 'İçe Aktarma Ürünü',
    shelf_location: 'İçe Aktarma Reyonu',
    sale_price: 100,
    ...overrides,
  };
}

describe('importProducts - yeni kayıtlar', () => {
  test('ürünleri ekler ve sayıyı bildirir', async () => {
    const result = await importProducts(
      staffUser.client,
      [product({ name: 'Birinci' }), product({ name: 'İkinci' })],
      staffUser.id
    );

    expect(result).toMatchObject({ inserted: 2, updated: 0, failures: [] });
  });

  test('eklenen ürün için initial_count kaydı yazar', async () => {
    const row = product({ name: 'Loglu Ürün', stock_quantity: 12 });
    await importProducts(staffUser.client, [row], staffUser.id);

    const saved = await getProductByCode(admin, row.code as string);
    expect(saved).not.toBeNull();

    const logs = await getStockLogsForProduct(admin, saved!.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      type: 'initial_count',
      old_stock: 0,
      new_stock: 12,
      change_amount: 12,
      user_id: staffUser.id,
    });
  });

  test('kodsuz satırlara sıradaki ENV kodlarını verir', async () => {
    const result = await importProducts(
      staffUser.client,
      [
        { barcode: null, name: 'Kodsuz Bir', shelf_location: 'Reyon K', sale_price: 10 },
        { barcode: null, name: 'Kodsuz İki', shelf_location: 'Reyon K', sale_price: 20 },
      ],
      staffUser.id
    );

    expect(result.inserted).toBe(2);

    const { data } = await admin
      .from('products')
      .select('id, code, name')
      .in('name', ['Kodsuz Bir', 'Kodsuz İki']);

    const rows = (data ?? []) as { id: number; code: string; name: string }[];
    for (const row of rows) {
      createdProductIds.push(row.id);
      expect(row.code).toMatch(/^ENV-\d+$/);
    }

    // İki satır aynı kodu almamalı.
    expect(new Set(rows.map((row) => row.code)).size).toBe(rows.length);
  });

  test('varsayılan alanlar uygulanır', async () => {
    const row = product({ name: 'Varsayılanlı' });
    await importProducts(staffUser.client, [row], staffUser.id);

    const saved = await getProductByCode(admin, row.code as string);

    expect(saved).toMatchObject({
      category: 'Genel',
      unit: 'Adet',
      min_stock_alert: 3,
      cost_price: 0,
      stock_quantity: 0,
    });
  });
});

describe('importProducts - güncellemeler', () => {
  test('aynı kodla gelen satır mevcut ürünü günceller', async () => {
    const code = trackedCode();

    await importProducts(
      staffUser.client,
      [{ code, barcode: null, name: 'İlk Hali', shelf_location: 'Reyon A', sale_price: 100, stock_quantity: 5 }],
      staffUser.id
    );

    const result = await importProducts(
      staffUser.client,
      [
        {
          code,
          barcode: null,
          name: 'Güncel Hali',
          shelf_location: 'Reyon B',
          sale_price: 150,
          stock_quantity: 8,
        },
      ],
      staffUser.id
    );

    expect(result).toMatchObject({ inserted: 0, updated: 1, failures: [] });

    const saved = await getProductByCode(admin, code);
    expect(saved).toMatchObject({
      name: 'Güncel Hali',
      shelf_location: 'Reyon B',
      sale_price: 150,
      stock_quantity: 8,
    });
  });

  test('güncellemede import türünde hareket kaydı yazar', async () => {
    const code = trackedCode();

    await importProducts(
      staffUser.client,
      [{ code, barcode: null, name: 'Hareketli', shelf_location: 'Reyon A', sale_price: 100, stock_quantity: 5 }],
      staffUser.id
    );

    await importProducts(
      staffUser.client,
      [{ code, barcode: null, name: 'Hareketli', shelf_location: 'Reyon A', sale_price: 120, stock_quantity: 9 }],
      staffUser.id
    );

    const saved = await getProductByCode(admin, code);
    const logs = await getStockLogsForProduct(admin, saved!.id);

    // En yeni kayıt başta.
    expect(logs[0]).toMatchObject({
      type: 'import',
      old_stock: 5,
      new_stock: 9,
      change_amount: 4,
      old_price: 100,
      new_price: 120,
    });
  });

  test('stok ve fiyat değişmediyse gereksiz hareket kaydı yazmaz', async () => {
    const code = trackedCode();
    const row: ImportedProduct = {
      code,
      barcode: null,
      name: 'Değişmeyen',
      shelf_location: 'Reyon A',
      sale_price: 100,
      stock_quantity: 5,
    };

    await importProducts(staffUser.client, [row], staffUser.id);
    await importProducts(staffUser.client, [{ ...row, notes: 'sadece not değişti' }], staffUser.id);

    const saved = await getProductByCode(admin, code);
    const logs = await getStockLogsForProduct(admin, saved!.id);

    // Yalnızca ilk kayıttaki initial_count kalmalı.
    expect(logs).toHaveLength(1);
    expect(logs[0]?.type).toBe('initial_count');
  });

  test('CSV kolonu yoksa mevcut değer korunur', async () => {
    // Boş kolon yüzünden dolu kategoriyi kaybetmemeliyiz.
    const code = trackedCode();

    await importProducts(
      staffUser.client,
      [
        {
          code,
          barcode: null,
          name: 'Kategorili',
          shelf_location: 'Reyon A',
          sale_price: 100,
          category: 'El Aletleri',
          unit: 'Kutu',
        },
      ],
      staffUser.id
    );

    await importProducts(
      staffUser.client,
      [{ code, barcode: null, name: 'Kategorili', shelf_location: 'Reyon A', sale_price: 110 }],
      staffUser.id
    );

    const saved = await getProductByCode(admin, code);
    expect(saved).toMatchObject({ category: 'El Aletleri', unit: 'Kutu', sale_price: 110 });
  });
});

describe('importProducts - hata yalıtımı', () => {
  test('çakışan barkod yalnızca o satırı düşürür', async () => {
    // Mağaza dosyasında tek çakışma yüzünden tüm aktarma düşmemeli.
    const barcode = '4006381333931';
    const existingCode = trackedCode();

    await importProducts(
      staffUser.client,
      [{ code: existingCode, barcode, name: 'Barkod Sahibi', shelf_location: 'Reyon A', sale_price: 50 }],
      staffUser.id
    );

    const conflictingCode = trackedCode();
    const okCode = trackedCode();

    const result = await importProducts(
      staffUser.client,
      [
        { code: conflictingCode, barcode, name: 'Çakışan', shelf_location: 'Reyon A', sale_price: 60 },
        { code: okCode, barcode: null, name: 'Sorunsuz', shelf_location: 'Reyon A', sale_price: 70 },
      ],
      staffUser.id
    );

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ code: conflictingCode });
    expect(result.failures[0]?.message).toContain('barkod');

    // Sorunsuz satır yazılmış olmalı.
    expect(await getProductByCode(admin, okCode)).not.toBeNull();
    expect(result.inserted).toBe(1);
  });

  test('boş liste güvenli şekilde sıfır döner', async () => {
    expect(await importProducts(staffUser.client, [], staffUser.id)).toEqual({
      inserted: 0,
      updated: 0,
      failures: [],
    });
  });

  test('görüntüleyici rolü içe aktarma yapamaz', async () => {
    const viewer = await createTestUser('viewer');

    try {
      const result = await importProducts(viewer.client, [product({ name: 'İzinsiz' })], viewer.id);

      // RLS yazmayı engelliyor: hiçbir ürün eklenmemeli.
      expect(result.inserted).toBe(0);
      expect(result.failures.length).toBeGreaterThan(0);
    } finally {
      await deleteTestUser(viewer);
    }
  });
});
