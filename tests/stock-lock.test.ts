// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { connectDb, wait } from './helpers/db';
import { createAdminClient, deleteProducts, uniqueProductCode } from './helpers/supabase';

/**
 * adjust_stock_and_price fonksiyonundaki satır kilidinin (`select ... for update`)
 * gerçekten iş gördüğünü belirleyici biçimde doğrular.
 *
 * Neden ayrı bir dosya: REST API üzerinden atılan paralel çağrılar ağda sıraya
 * girdiği için araya girme (interleaving) oluşmuyor ve kilidi kaldırsan bile o
 * testler geçiyor. Burada iki ayrı veritabanı oturumu açıp sıralamayı elle
 * kuruyoruz:
 *
 *   1. A oturumu satırı kilitler ve kilidi tutar.
 *   2. B oturumu fonksiyonu çağırır; kilit yüzünden beklemek zorundadır.
 *   3. A stoğu düşürüp işlemi tamamlar.
 *   4. B devam eder ve A'nın bıraktığı güncel değeri görmelidir.
 *
 * Kilit kaldırılırsa: B adım 2'de beklemez (kilit testi düşer) ve eski stok
 * değerini okuyup yanlış bir denetim kaydı yazar (zincir testi düşer).
 */

const admin = createAdminClient();
const createdProductIds: number[] = [];

let sessionA: Client;
let sessionB: Client;

beforeAll(async () => {
  [sessionA, sessionB] = await Promise.all([connectDb(), connectDb()]);
});

afterAll(async () => {
  await deleteProducts(createdProductIds);
  await Promise.all([sessionA?.end(), sessionB?.end()]);
});

async function createProduct(stock: number): Promise<number> {
  const { data, error } = await admin
    .from('products')
    .insert({
      code: uniqueProductCode(),
      name: 'Kilit Testi Ürünü',
      shelf_location: 'Test Reyonu',
      sale_price: 20,
      stock_quantity: stock,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Test ürünü oluşturulamadı: ${error?.message}`);
  }

  const id = (data as { id: number }).id;
  createdProductIds.push(id);

  return id;
}

describe('adjust_stock_and_price satır kilidi', () => {
  test('kilit tutulurken gelen çağrı bekler ve güncel değerin üstüne yazar', async () => {
    const productId = await createProduct(20);

    // 1. A oturumu satırı kilitler.
    await sessionA.query('begin');
    await sessionA.query('select * from public.products where id = $1 for update', [productId]);

    // 2. B oturumu fonksiyonu çağırır; kilit yüzünden bloke olmalı.
    let finished = false;
    const pending = sessionB
      .query('select public.adjust_stock_and_price($1, -1) as product', [productId])
      .then((result) => {
        finished = true;

        return result;
      });

    await wait(600);
    expect(
      finished,
      'Fonksiyon satır kilidini beklemedi; `for update` kaldırılmış olabilir'
    ).toBe(false);

    // 3. A stoğu düşürüp işlemi tamamlar: 20 -> 19.
    await sessionA.query(
      'update public.products set stock_quantity = stock_quantity - 1 where id = $1',
      [productId]
    );
    await sessionA.query('commit');

    // 4. B devam eder ve 19 üzerinden işler: 19 -> 18.
    await pending;

    const { data: product } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', productId)
      .single();

    expect(product?.stock_quantity).toBe(18);

    const { data: logs } = await admin
      .from('stock_logs')
      .select('change_amount, old_stock, new_stock')
      .eq('product_id', productId)
      .order('id', { ascending: true });

    // Fonksiyonun yazdığı tek kayıt, A'nın bıraktığı değeri görmüş olmalı.
    expect(logs).toHaveLength(1);
    expect(logs?.[0]).toMatchObject({
      change_amount: -1,
      old_stock: 19,
      new_stock: 18,
    });
  });

  test('kilit beklenirken sayım değeri de güncel satırın üstüne uygulanır', async () => {
    const productId = await createProduct(10);

    await sessionA.query('begin');
    await sessionA.query('select * from public.products where id = $1 for update', [productId]);

    const pending = sessionB.query(
      'select public.adjust_stock_and_price($1, null, 4) as product',
      [productId]
    );

    await wait(400);

    // A stoğu 10 -> 7 yapar; ardından B sayım sonucunu 4 olarak yazar.
    await sessionA.query('update public.products set stock_quantity = 7 where id = $1', [
      productId,
    ]);
    await sessionA.query('commit');
    await pending;

    const { data: product } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', productId)
      .single();

    expect(product?.stock_quantity).toBe(4);

    const { data: logs } = await admin
      .from('stock_logs')
      .select('old_stock, new_stock, change_amount')
      .eq('product_id', productId)
      .single();

    // Sayım, A'nın bıraktığı 7 değerinin üstüne yazıldığı için değişim -3 olmalı.
    expect(logs).toMatchObject({ old_stock: 7, new_stock: 4, change_amount: -3 });
  });
});
