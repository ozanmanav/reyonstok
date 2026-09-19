// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  adjustStockAndPrice,
  createProduct,
  deleteProduct,
  getAllCategories,
  getAllProducts,
  getAllShelves,
  getInventoryStats,
  getNextProductCode,
  getProductByCode,
  getProductById,
  updateProduct,
} from '@/lib/repo/products';
import { getRecentStockLogs, getStockLogsForProduct } from '@/lib/repo/stock-logs';
import { buildScanUrl } from '@/lib/scan-code';
import {
  createAdminClient,
  createTestUser,
  deleteProducts,
  deleteTestUser,
  uniqueProductCode,
  type TestUser,
} from './helpers/supabase';

/**
 * Veri erişim katmanının gerçek Supabase projesine karşı doğrulanması.
 *
 * Testler iki farklı istemciyle çalışır: yönetim istemcisi (veri hazırlama) ve
 * rolü belirli kullanıcı istemcisi (RLS'in devrede olduğu gerçek senaryo).
 */

const admin = createAdminClient();
const createdProductIds: number[] = [];

let staffUser: TestUser;
let viewerUser: TestUser;
let adminUser: TestUser;

beforeAll(async () => {
  [staffUser, viewerUser, adminUser] = await Promise.all([
    createTestUser('staff'),
    createTestUser('viewer'),
    createTestUser('admin'),
  ]);
});

afterAll(async () => {
  await deleteProducts(createdProductIds);
  await Promise.all(
    [staffUser, viewerUser, adminUser].filter(Boolean).map((user) => deleteTestUser(user))
  );
});

/** Testin sonunda silinmek üzere ürün oluşturur. */
async function makeProduct(overrides: Parameters<typeof createProduct>[1] | null = null) {
  const product = await createProduct(
    staffUser.client,
    overrides ?? {
      code: uniqueProductCode(),
      name: 'Repo Test Ürünü',
      shelf_location: 'Repo Reyonu',
      sale_price: 100,
      stock_quantity: 10,
    },
    staffUser.id
  );

  createdProductIds.push(product.id);

  return product;
}

describe('createProduct', () => {
  test('ürünü kaydeder ve başlangıç stoğunu loglar', async () => {
    const product = await makeProduct({
      code: uniqueProductCode(),
      name: 'Başlangıç Stoklu Ürün',
      shelf_location: 'Repo Reyonu',
      sale_price: 75.5,
      stock_quantity: 7,
    });

    expect(product.name).toBe('Başlangıç Stoklu Ürün');
    expect(product.stock_quantity).toBe(7);
    expect(product.sale_price).toBe(75.5);

    const logs = await getStockLogsForProduct(admin, product.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      type: 'initial_count',
      change_amount: 7,
      old_stock: 0,
      new_stock: 7,
      user_id: staffUser.id,
    });
  });

  test('kod verilmezse sıradaki ENV kodunu üretir', async () => {
    const expected = await getNextProductCode(staffUser.client);

    const product = await makeProduct({
      name: 'Otomatik Kodlu Ürün',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    expect(product.code).toBe(expected);
    expect(product.code).toMatch(/^ENV-\d+$/);
  });

  test('küçük harfli kod büyük harfe çevrilir', async () => {
    const product = await makeProduct({
      code: `test-kucuk-${Date.now()}`,
      name: 'Küçük Harfli Kod',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    expect(product.code).toBe(product.code.toUpperCase());
  });

  test('boş barkod null olarak saklanır', async () => {
    const product = await makeProduct({
      code: uniqueProductCode(),
      barcode: '   ',
      name: 'Barkodsuz Ürün',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    expect(product.barcode).toBeNull();
  });

  test('varsayılan alanlar dolduruluyor', async () => {
    const product = await makeProduct({
      code: uniqueProductCode(),
      name: 'Varsayılanlı Ürün',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    expect(product.category).toBe('Genel');
    expect(product.unit).toBe('Adet');
    expect(product.min_stock_alert).toBe(3);
    expect(product.cost_price).toBe(0);
    expect(product.stock_quantity).toBe(0);
    expect(product.notes).toBe('');
  });

  test('viewer rolü ürün oluşturamaz', async () => {
    await expect(
      createProduct(
        viewerUser.client,
        {
          code: uniqueProductCode(),
          name: 'İzinsiz',
          shelf_location: 'Repo Reyonu',
          sale_price: 10,
        },
        viewerUser.id
      )
    ).rejects.toThrow();
  });
});

describe('getProductByCode', () => {
  test('ürün kodunu bulur', async () => {
    const product = await makeProduct();

    const found = await getProductByCode(staffUser.client, product.code);

    expect(found?.id).toBe(product.id);
  });

  test('küçük harf yazılmış ENV kodunu bulur', async () => {
    const product = await makeProduct({
      name: 'ENV Kodlu',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    const found = await getProductByCode(staffUser.client, product.code.toLowerCase());

    expect(found?.id).toBe(product.id);
  });

  test('EAN-13 barkodunu bulur', async () => {
    const barcode = '4006381333931';
    const product = await makeProduct({
      code: uniqueProductCode(),
      barcode,
      name: 'Barkodlu Ürün',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    const found = await getProductByCode(staffUser.client, barcode);

    expect(found?.id).toBe(product.id);
  });

  test('etiketteki karekod adresinden ürünü bulur', async () => {
    const product = await makeProduct({
      name: 'Etiketli Ürün',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    const url = buildScanUrl(product.code, 'https://reyonstok.vercel.app');
    const found = await getProductByCode(staffUser.client, url);

    expect(found?.id).toBe(product.id);
  });

  test('EAN-8 gibi doğrulanamayan barkodu da barkod alanında arar', async () => {
    const barcode = '96385074';
    const product = await makeProduct({
      code: uniqueProductCode(),
      barcode,
      name: 'EAN-8 Ürünü',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    const found = await getProductByCode(staffUser.client, barcode);

    expect(found?.id).toBe(product.id);
  });

  test('bulunamayan kod için null döner', async () => {
    const found = await getProductByCode(staffUser.client, 'ENV-9999999');

    expect(found).toBeNull();
  });

  test('boş değer için veritabanına gitmeden null döner', async () => {
    expect(await getProductByCode(staffUser.client, '')).toBeNull();
    expect(await getProductByCode(staffUser.client, '   ')).toBeNull();
    expect(
      await getProductByCode(staffUser.client, 'https://reyonstok.vercel.app/scan')
    ).toBeNull();
  });
});

describe('getAllProducts filtreleri', () => {
  test('reyona göre filtreler', async () => {
    const shelf = `Filtre Reyonu ${Date.now()}`;
    const product = await makeProduct({
      code: uniqueProductCode(),
      name: 'Reyon Filtresi',
      shelf_location: shelf,
      sale_price: 10,
    });

    const results = await getAllProducts(staffUser.client, { shelf });

    expect(results.map((item) => item.id)).toEqual([product.id]);
  });

  test('kategoriye göre filtreler', async () => {
    const category = `Kategori ${Date.now()}`;
    const product = await makeProduct({
      code: uniqueProductCode(),
      name: 'Kategori Filtresi',
      category,
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    const results = await getAllProducts(staffUser.client, { category });

    expect(results.map((item) => item.id)).toEqual([product.id]);
  });

  test('ada göre arar', async () => {
    const name = `Aranan Ürün ${Date.now()}`;
    const product = await makeProduct({
      code: uniqueProductCode(),
      name,
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    const results = await getAllProducts(staffUser.client, { search: name });

    expect(results.map((item) => item.id)).toContain(product.id);
  });

  test('barkoda göre arar', async () => {
    const barcode = '5901234123457';
    const product = await makeProduct({
      code: uniqueProductCode(),
      barcode,
      name: 'Barkodla Aranan',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    const results = await getAllProducts(staffUser.client, { search: barcode });

    expect(results.map((item) => item.id)).toContain(product.id);
  });

  test('arama metnindeki joker karakter düz metin olarak aranır', async () => {
    // Kaçışlama olmasaydı `%` tüm ürünleri getirir, kullanıcı yanlış sonuç görürdü.
    const results = await getAllProducts(staffUser.client, { search: '%' });

    expect(results).toEqual([]);
  });

  test('kritik stok filtresi yalnızca eşiğin altındakileri getirir', async () => {
    const shelf = `Kritik Reyon ${Date.now()}`;
    const low = await makeProduct({
      code: uniqueProductCode(),
      name: 'Azalan Ürün',
      shelf_location: shelf,
      sale_price: 10,
      stock_quantity: 2,
      min_stock_alert: 5,
    });
    await makeProduct({
      code: uniqueProductCode(),
      name: 'Bol Stoklu Ürün',
      shelf_location: shelf,
      sale_price: 10,
      stock_quantity: 50,
      min_stock_alert: 5,
    });

    const results = await getAllProducts(staffUser.client, { shelf, lowStock: true });

    expect(results.map((item) => item.id)).toEqual([low.id]);
    expect(results[0]?.is_low_stock).toBe(true);
  });

  test('stok değişince kritik stok işareti kendiliğinden güncellenir', async () => {
    const product = await makeProduct({
      code: uniqueProductCode(),
      name: 'Eşiğe Düşen Ürün',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
      stock_quantity: 10,
      min_stock_alert: 5,
    });

    expect(product.is_low_stock).toBe(false);

    const updated = await adjustStockAndPrice(staffUser.client, {
      productId: product.id,
      absoluteStock: 4,
    });

    const refreshed = await getProductById(staffUser.client, updated.id);
    expect(refreshed?.is_low_stock).toBe(true);
  });

  test('limit uygulanır', async () => {
    const results = await getAllProducts(staffUser.client, { limit: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('updateProduct', () => {
  test('verilen alanları günceller, diğerlerine dokunmaz', async () => {
    const product = await makeProduct();

    const updated = await updateProduct(staffUser.client, product.id, { sale_price: 150 });

    expect(updated?.sale_price).toBe(150);
    expect(updated?.name).toBe(product.name);
    expect(updated?.stock_quantity).toBe(product.stock_quantity);
  });

  test('boş yama gönderildiğinde ürünü değiştirmeden döner', async () => {
    const product = await makeProduct();

    const updated = await updateProduct(staffUser.client, product.id, {});

    expect(updated?.updated_at).toBe(product.updated_at);
  });

  test('barkod boşaltılabilir', async () => {
    const product = await makeProduct({
      code: uniqueProductCode(),
      barcode: '0012345678905',
      name: 'Barkodu Silinecek',
      shelf_location: 'Repo Reyonu',
      sale_price: 10,
    });

    const updated = await updateProduct(staffUser.client, product.id, { barcode: '' });

    expect(updated?.barcode).toBeNull();
  });

  test('viewer rolünün güncellemesi satır döndürmez', async () => {
    const product = await makeProduct();

    const updated = await updateProduct(viewerUser.client, product.id, { sale_price: 999 });

    expect(updated).toBeNull();

    const unchanged = await getProductById(admin, product.id);
    expect(unchanged?.sale_price).toBe(product.sale_price);
  });
});

describe('deleteProduct', () => {
  test('yönetici ürünü siler', async () => {
    const product = await makeProduct();

    const deleted = await deleteProduct(adminUser.client, product.id);

    expect(deleted).toBe(true);
    expect(await getProductById(admin, product.id)).toBeNull();
  });

  test('staff rolü silemez', async () => {
    const product = await makeProduct();

    const deleted = await deleteProduct(staffUser.client, product.id);

    expect(deleted).toBe(false);
    expect(await getProductById(admin, product.id)).not.toBeNull();
  });
});

describe('adjustStockAndPrice', () => {
  test('göreli değişimi uygular', async () => {
    const product = await makeProduct();

    const updated = await adjustStockAndPrice(staffUser.client, {
      productId: product.id,
      stockDelta: -3,
      note: 'Test azaltma',
    });

    expect(updated.stock_quantity).toBe(product.stock_quantity - 3);
  });

  test('fiyatı günceller', async () => {
    const product = await makeProduct();

    const updated = await adjustStockAndPrice(staffUser.client, {
      productId: product.id,
      newSalePrice: 133.75,
    });

    expect(updated.sale_price).toBe(133.75);
  });

  test('viewer rolü için hata fırlatır', async () => {
    const product = await makeProduct();

    await expect(
      adjustStockAndPrice(viewerUser.client, { productId: product.id, stockDelta: -1 })
    ).rejects.toThrow();
  });
});

describe('yardımcı listeler ve özet', () => {
  test('reyon listesi tekrarsız gelir', async () => {
    const shelf = `Tekil Reyon ${Date.now()}`;
    await makeProduct({
      code: uniqueProductCode(),
      name: 'Birinci',
      shelf_location: shelf,
      sale_price: 10,
    });
    await makeProduct({
      code: uniqueProductCode(),
      name: 'İkinci',
      shelf_location: shelf,
      sale_price: 10,
    });

    const shelves = await getAllShelves(staffUser.client);

    expect(shelves.filter((item) => item === shelf)).toHaveLength(1);
  });

  test('kategori listesi tekrarsız gelir', async () => {
    const categories = await getAllCategories(staffUser.client);

    expect(new Set(categories).size).toBe(categories.length);
  });

  test('envanter özeti sayısal alanlar döndürür', async () => {
    const stats = await getInventoryStats(staffUser.client);

    expect(typeof stats.total_products).toBe('number');
    expect(typeof stats.total_inventory_value).toBe('number');
    expect(stats.total_products).toBeGreaterThan(0);
  });
});

describe('hareket kayıtları', () => {
  test('son hareketler ürün bilgisiyle birlikte gelir', async () => {
    const product = await makeProduct();
    await adjustStockAndPrice(staffUser.client, { productId: product.id, stockDelta: -1 });

    const logs = await getRecentStockLogs(staffUser.client, 50);
    const entry = logs.find((log) => log.product_id === product.id && log.change_amount === -1);

    expect(entry).toBeDefined();
    expect(entry?.product?.code).toBe(product.code);
    expect(entry?.product?.name).toBe(product.name);
  });

  test('kullanıcı kendi hareketinde adını görür', async () => {
    const product = await makeProduct();
    await adjustStockAndPrice(staffUser.client, { productId: product.id, stockDelta: -1 });

    const logs = await getStockLogsForProduct(staffUser.client, product.id);
    const adjustment = logs.find((log) => log.change_amount === -1);

    expect(adjustment?.user?.full_name).toBe('Test staff');
  });

  test('ürün hareketleri en yeniden eskiye sıralı gelir', async () => {
    const product = await makeProduct();
    await adjustStockAndPrice(staffUser.client, { productId: product.id, stockDelta: -1 });
    await adjustStockAndPrice(staffUser.client, { productId: product.id, stockDelta: -2 });

    const logs = await getStockLogsForProduct(staffUser.client, product.id);

    expect(logs[0]?.change_amount).toBe(-2);
    expect(logs.at(-1)?.type).toBe('initial_count');
  });
});
