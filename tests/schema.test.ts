// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  createAdminClient,
  createTestUser,
  deleteProducts,
  deleteTestUser,
  seedProduct,
  uniqueProductCode,
  type TestUser,
} from './helpers/supabase';

/**
 * Şema, RLS politikaları ve atomik stok fonksiyonunun gerçek Supabase projesine
 * karşı doğrulanması.
 *
 * Doğrulanan davranışlar:
 *  - Yeni Auth kullanıcısına otomatik viewer profili açılması
 *  - Rol bazlı okuma/yazma/silme yetkileri
 *  - Eş zamanlı stok güncellemelerinde kayıp güncelleme olmaması
 *  - Stoğun sıfırın altına düşmemesi
 *  - Her gerçek değişikliğin kullanıcı kimliğiyle loglanması
 *  - Denetim kaydının değiştirilemez olması
 */

let admin: ReturnType<typeof createAdminClient>;
let adminUser: TestUser;
let staffUser: TestUser;
let viewerUser: TestUser;
const createdProductIds: number[] = [];

beforeAll(async () => {
  admin = createAdminClient();
  [adminUser, staffUser, viewerUser] = await Promise.all([
    createTestUser('admin'),
    createTestUser('staff'),
    createTestUser('viewer'),
  ]);
});

afterAll(async () => {
  await deleteProducts(createdProductIds);
  await Promise.all(
    [adminUser, staffUser, viewerUser].filter(Boolean).map((user) => deleteTestUser(user))
  );
});

/** Test ürünü oluşturup sonunda temizlenmek üzere kaydeder. */
async function createProduct(options: Parameters<typeof seedProduct>[0] = {}) {
  const product = await seedProduct(options);
  createdProductIds.push(product.id);

  return product;
}

describe('profiller ve kullanıcı oluşturma', () => {
  test('yeni Auth kullanıcısı için otomatik profil açılır ve rolü viewer olur', async () => {
    const fresh = await createTestUser('viewer');

    try {
      const { data, error } = await admin
        .from('profiles')
        .select('id, role, is_active')
        .eq('id', fresh.id)
        .single();

      expect(error).toBeNull();
      expect(data).toMatchObject({ id: fresh.id, role: 'viewer', is_active: true });
    } finally {
      await deleteTestUser(fresh);
    }
  });

  test('kullanıcı kendi profilini görür, başkasının profilini görmez', async () => {
    const { data: own } = await staffUser.client
      .from('profiles')
      .select('id')
      .eq('id', staffUser.id)
      .maybeSingle();

    const { data: other } = await staffUser.client
      .from('profiles')
      .select('id')
      .eq('id', viewerUser.id)
      .maybeSingle();

    expect(own?.id).toBe(staffUser.id);
    expect(other).toBeNull();
  });

  test('yönetici tüm profilleri görür', async () => {
    const { data, error } = await adminUser.client
      .from('profiles')
      .select('id')
      .in('id', [adminUser.id, staffUser.id, viewerUser.id]);

    expect(error).toBeNull();
    expect(data?.length).toBe(3);
  });

  test('personel kendi rolünü yükseltemez', async () => {
    const { error } = await staffUser.client
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', staffUser.id);

    // RLS with check koşulu ihlal edildiği için güncelleme reddedilir.
    expect(error).not.toBeNull();

    const { data } = await admin
      .from('profiles')
      .select('role')
      .eq('id', staffUser.id)
      .single();

    expect(data?.role).toBe('staff');
  });
});

describe('ürünler üzerinde rol bazlı yetkiler', () => {
  test('viewer ürünleri okuyabilir', async () => {
    const product = await createProduct({ name: 'Okunabilir Ürün' });

    const { data, error } = await viewerUser.client
      .from('products')
      .select('id, name')
      .eq('id', product.id)
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe('Okunabilir Ürün');
  });

  test('viewer ürün ekleyemez', async () => {
    const { error } = await viewerUser.client.from('products').insert({
      code: uniqueProductCode(),
      name: 'İzinsiz Ürün',
      shelf_location: 'Test Reyonu',
      sale_price: 10,
    });

    expect(error).not.toBeNull();
  });

  test('viewer ürün güncelleyemez', async () => {
    const product = await createProduct({ sale_price: 50 });

    await viewerUser.client.from('products').update({ sale_price: 999 }).eq('id', product.id);

    const { data } = await admin
      .from('products')
      .select('sale_price')
      .eq('id', product.id)
      .single();

    expect(Number(data?.sale_price)).toBe(50);
  });

  test('staff ürün ekleyip güncelleyebilir', async () => {
    const code = uniqueProductCode();

    const { data: inserted, error: insertError } = await staffUser.client
      .from('products')
      .insert({
        code,
        name: 'Personel Ürünü',
        shelf_location: 'Test Reyonu',
        sale_price: 25,
      })
      .select('id')
      .single();

    expect(insertError).toBeNull();
    const productId = (inserted as { id: number }).id;
    createdProductIds.push(productId);

    const { error: updateError } = await staffUser.client
      .from('products')
      .update({ sale_price: 30 })
      .eq('id', productId);

    expect(updateError).toBeNull();
  });

  test('staff ürün silemez, yönetici silebilir', async () => {
    const product = await createProduct();

    await staffUser.client.from('products').delete().eq('id', product.id);

    const { data: stillThere } = await admin
      .from('products')
      .select('id')
      .eq('id', product.id)
      .maybeSingle();

    expect(stillThere?.id).toBe(product.id);

    await adminUser.client.from('products').delete().eq('id', product.id);

    const { data: deleted } = await admin
      .from('products')
      .select('id')
      .eq('id', product.id)
      .maybeSingle();

    expect(deleted).toBeNull();
  });

  test('pasif kullanıcı ürünleri göremez', async () => {
    const suspended = await createTestUser('staff');

    try {
      await admin.from('profiles').update({ is_active: false }).eq('id', suspended.id);

      const { data } = await suspended.client.from('products').select('id').limit(1);

      expect(data).toEqual([]);
    } finally {
      await deleteTestUser(suspended);
    }
  });
});

describe('benzersizlik kısıtları', () => {
  test('aynı ürün kodu ikinci kez eklenemez', async () => {
    const product = await createProduct();

    const { error } = await admin.from('products').insert({
      code: product.code,
      name: 'Kopya Kod',
      shelf_location: 'Test Reyonu',
      sale_price: 10,
    });

    expect(error?.code).toBe('23505');
  });

  test('aynı barkod ikinci kez eklenemez', async () => {
    const barcode = `9${Date.now()}`.slice(0, 13);
    await createProduct({ barcode });

    const { error } = await admin.from('products').insert({
      code: uniqueProductCode(),
      barcode,
      name: 'Kopya Barkod',
      shelf_location: 'Test Reyonu',
      sale_price: 10,
    });

    expect(error?.code).toBe('23505');
  });

  test('barkodu olmayan birden fazla ürün eklenebilir', async () => {
    const first = await createProduct({ barcode: null });
    const second = await createProduct({ barcode: null });

    expect(first.id).not.toBe(second.id);
  });

  test('küçük harfli ürün kodu kabul edilmez', async () => {
    const { error } = await admin.from('products').insert({
      code: 'test-kucuk-harf',
      name: 'Küçük Harf',
      shelf_location: 'Test Reyonu',
      sale_price: 10,
    });

    expect(error).not.toBeNull();
  });

  test('negatif stok doğrudan yazılamaz', async () => {
    const { error } = await admin.from('products').insert({
      code: uniqueProductCode(),
      name: 'Negatif Stok',
      shelf_location: 'Test Reyonu',
      sale_price: 10,
      stock_quantity: -5,
    });

    expect(error).not.toBeNull();
  });
});

describe('adjust_stock_and_price', () => {
  test('stoğu göreli olarak düşürür ve hareketi kullanıcı kimliğiyle loglar', async () => {
    const product = await createProduct({ stock_quantity: 10, sale_price: 20 });

    const { data, error } = await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_stock_delta: -1,
      p_note: 'Reyon taraması',
    });

    expect(error).toBeNull();
    expect(data?.stock_quantity).toBe(9);

    const { data: logs } = await admin
      .from('stock_logs')
      .select('user_id, change_amount, old_stock, new_stock, type, note')
      .eq('product_id', product.id);

    expect(logs).toHaveLength(1);
    expect(logs?.[0]).toMatchObject({
      user_id: staffUser.id,
      change_amount: -1,
      old_stock: 10,
      new_stock: 9,
      type: 'stock_adjustment',
      note: 'Reyon taraması',
    });
  });

  test('sayılan adedi kesin değer olarak yazar', async () => {
    const product = await createProduct({ stock_quantity: 10 });

    const { data, error } = await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_absolute_stock: 4,
    });

    expect(error).toBeNull();
    expect(data?.stock_quantity).toBe(4);
  });

  test('stok sıfırın altına inmez', async () => {
    const product = await createProduct({ stock_quantity: 2 });

    const { data, error } = await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_stock_delta: -10,
    });

    expect(error).toBeNull();
    expect(data?.stock_quantity).toBe(0);
  });

  test('yalnızca fiyat değiştiğinde price_update olarak loglanır', async () => {
    const product = await createProduct({ stock_quantity: 5, sale_price: 20 });

    const { data, error } = await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_new_sale_price: 24.5,
    });

    expect(error).toBeNull();
    expect(Number(data?.sale_price)).toBe(24.5);
    expect(data?.stock_quantity).toBe(5);

    const { data: logs } = await admin
      .from('stock_logs')
      .select('type, change_amount, old_price, new_price')
      .eq('product_id', product.id);

    expect(logs).toHaveLength(1);
    expect(logs?.[0]?.type).toBe('price_update');
    expect(Number(logs?.[0]?.old_price)).toBe(20);
    expect(Number(logs?.[0]?.new_price)).toBe(24.5);
  });

  test('hiçbir şey değişmediğinde gereksiz hareket kaydı yazmaz', async () => {
    const product = await createProduct({ stock_quantity: 5, sale_price: 20 });

    const { error } = await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_new_sale_price: 20,
    });

    expect(error).toBeNull();

    const { data: logs } = await admin
      .from('stock_logs')
      .select('id')
      .eq('product_id', product.id);

    expect(logs).toHaveLength(0);
  });

  test('stok değişimi ve sayılan adet birlikte gönderilemez', async () => {
    const product = await createProduct({ stock_quantity: 5 });

    const { error } = await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_stock_delta: -1,
      p_absolute_stock: 3,
    });

    expect(error).not.toBeNull();
  });

  test('olmayan ürün için hata döner', async () => {
    const { error } = await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: 999_999_999,
      p_stock_delta: -1,
    });

    expect(error).not.toBeNull();
  });

  test('viewer rolü stok güncelleyemez', async () => {
    const product = await createProduct({ stock_quantity: 7 });

    const { error } = await viewerUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_stock_delta: -1,
    });

    expect(error).not.toBeNull();

    const { data } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', product.id)
      .single();

    expect(data?.stock_quantity).toBe(7);
  });

  test('eş zamanlı iki azaltma çağrısında güncelleme kaybolmaz', async () => {
    // Uygulamada oku-değiştir-yaz yapılsaydı iki çağrıdan biri diğerini ezip
    // stok 9'da kalırdı. Satır kilidi sayesinde ikisi de uygulanmalı.
    const product = await createProduct({ stock_quantity: 10 });

    const results = await Promise.all([
      staffUser.client.rpc('adjust_stock_and_price', {
        p_product_id: product.id,
        p_stock_delta: -1,
      }),
      adminUser.client.rpc('adjust_stock_and_price', {
        p_product_id: product.id,
        p_stock_delta: -1,
      }),
    ]);

    for (const result of results) {
      expect(result.error).toBeNull();
    }

    const { data } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', product.id)
      .single();

    expect(data?.stock_quantity).toBe(8);

    const { data: logs } = await admin
      .from('stock_logs')
      .select('id')
      .eq('product_id', product.id);

    expect(logs).toHaveLength(2);
  });

  test('beş eş zamanlı azaltma çağrısı tam beş adet düşürür', async () => {
    const product = await createProduct({ stock_quantity: 20 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        staffUser.client.rpc('adjust_stock_and_price', {
          p_product_id: product.id,
          p_stock_delta: -1,
        })
      )
    );

    for (const result of results) {
      expect(result.error).toBeNull();
    }

    const { data } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', product.id)
      .single();

    expect(data?.stock_quantity).toBe(15);
  });

  test('eş zamanlı çağrıların hareket kayıtları kesintisiz bir zincir oluşturur', async () => {
    // Uçtan uca tutarlılık kontrolü: her satırın new_stock'u bir sonrakinin
    // old_stock'u olmalı.
    //
    // NOT: Bu test satır kilidinin varlığını kanıtlamaz. REST API üzerinden
    // atılan paralel çağrılar ağda sıraya girdiği için araya girme oluşmuyor ve
    // `for update` kaldırıldığında bu test yine geçiyor. Kilidin belirleyici
    // doğrulaması tests/stock-lock.test.ts içinde, iki ayrı veritabanı oturumu
    // ile yapılıyor.
    const product = await createProduct({ stock_quantity: 20 });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        staffUser.client.rpc('adjust_stock_and_price', {
          p_product_id: product.id,
          p_stock_delta: -1,
        })
      )
    );

    const { data: logs } = await admin
      .from('stock_logs')
      .select('old_stock, new_stock')
      .eq('product_id', product.id)
      .order('id', { ascending: true });

    expect(logs).toHaveLength(5);

    const chain = (logs ?? []) as { old_stock: number; new_stock: number }[];
    expect(chain.map((row) => row.old_stock)).toEqual([20, 19, 18, 17, 16]);
    expect(chain.map((row) => row.new_stock)).toEqual([19, 18, 17, 16, 15]);
  });
});

describe('denetim kaydının değiştirilemezliği', () => {
  test('personel hareket kaydını güncelleyemez', async () => {
    const product = await createProduct({ stock_quantity: 5 });
    await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_stock_delta: -1,
    });

    const { data: log } = await admin
      .from('stock_logs')
      .select('id')
      .eq('product_id', product.id)
      .single();

    const logId = (log as { id: number }).id;

    await staffUser.client.from('stock_logs').update({ change_amount: -99 }).eq('id', logId);

    const { data: unchanged } = await admin
      .from('stock_logs')
      .select('change_amount')
      .eq('id', logId)
      .single();

    expect(unchanged?.change_amount).toBe(-1);
  });

  test('yönetici bile hareket kaydını silemez', async () => {
    const product = await createProduct({ stock_quantity: 5 });
    await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_stock_delta: -1,
    });

    await adminUser.client.from('stock_logs').delete().eq('product_id', product.id);

    const { data: logs } = await admin
      .from('stock_logs')
      .select('id')
      .eq('product_id', product.id);

    expect(logs).toHaveLength(1);
  });

  test('personel başkasının adına hareket kaydı yazamaz', async () => {
    const product = await createProduct({ stock_quantity: 5 });

    const { error } = await staffUser.client.from('stock_logs').insert({
      product_id: product.id,
      user_id: viewerUser.id,
      change_amount: -1,
      old_stock: 5,
      new_stock: 4,
    });

    expect(error).not.toBeNull();
  });
});

describe('inventory_stats görünümü', () => {
  test('ürün sayısı, toplam adet ve kritik stok bilgisini verir', async () => {
    const { data, error } = await staffUser.client
      .from('inventory_stats')
      .select('*')
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Number(data?.total_products)).toBeGreaterThanOrEqual(0);
    expect(Number(data?.total_stock_units)).toBeGreaterThanOrEqual(0);
    expect(Number(data?.total_inventory_value)).toBeGreaterThanOrEqual(0);
  });

  test('tükenen ürünü out_of_stock_count içinde sayar', async () => {
    const before = await staffUser.client.from('inventory_stats').select('*').single();
    const product = await createProduct({ stock_quantity: 1, min_stock_alert: 3 });

    await staffUser.client.rpc('adjust_stock_and_price', {
      p_product_id: product.id,
      p_absolute_stock: 0,
    });

    const after = await staffUser.client.from('inventory_stats').select('*').single();

    expect(Number(after.data?.out_of_stock_count)).toBe(
      Number(before.data?.out_of_stock_count) + 1
    );
  });
});
