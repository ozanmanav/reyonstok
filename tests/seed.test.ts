// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { isValidEan13, normalizeScan } from '@/lib/scan-code';
import type { Product } from '@/lib/types';
import { createAdminClient } from './helpers/supabase';

/**
 * Tohum verisinin (supabase/seed.sql) gerçekten kullanılabilir olduğunu
 * doğrular. Özellikle barkodların geçerli EAN-13 kontrol hanesi taşıması
 * önemli: aksi halde tarama akışını elle denerken barkod okunmuş gibi görünüp
 * ürün bulunamıyor sanılır.
 */

const admin = createAdminClient();

describe('tohum verisi', () => {
  test('örnek ürünler yüklenmiş', async () => {
    const { data, error } = await admin.from('products').select('code').like('code', 'ENV-%');

    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(10);
  });

  test('tüm örnek barkodlar geçerli EAN-13', async () => {
    const { data } = await admin
      .from('products')
      .select('code, barcode')
      .like('code', 'ENV-%')
      .not('barcode', 'is', null);

    const products = (data ?? []) as Pick<Product, 'code' | 'barcode'>[];
    expect(products.length).toBeGreaterThan(0);

    const invalid = products.filter((product) => !isValidEan13(product.barcode ?? ''));
    expect(invalid.map((product) => `${product.code}: ${product.barcode}`)).toEqual([]);
  });

  test('örnek ürün kodları tarama tarafında karekod olarak tanınır', async () => {
    const { data } = await admin.from('products').select('code').like('code', 'ENV-%').limit(3);

    for (const row of (data ?? []) as { code: string }[]) {
      const result = normalizeScan(row.code);

      expect(result.kind).toBe('qr');
      expect(result.code).toBe(row.code);
    }
  });

  test('örnek barkodlar tarama tarafında EAN-13 olarak tanınır', async () => {
    const { data } = await admin
      .from('products')
      .select('barcode')
      .like('code', 'ENV-%')
      .not('barcode', 'is', null)
      .limit(3);

    for (const row of (data ?? []) as { barcode: string }[]) {
      const result = normalizeScan(row.barcode);

      expect(result.kind).toBe('ean13');
      expect(result.code).toBe(row.barcode);
    }
  });

  test('kritik ve tükenen stok örnekleri içerir', async () => {
    // Ana panelin uyarı kartlarını ve kritik stok filtresini elle denemek için
    // tohum verisinde en az bir tükenen ve bir azalan ürün bulunmalı.
    const { data: stats } = await admin.from('inventory_stats').select('*').single();

    expect(Number(stats?.out_of_stock_count)).toBeGreaterThanOrEqual(1);
    expect(Number(stats?.low_stock_count)).toBeGreaterThanOrEqual(1);
  });

  test('barkodu olmayan ürün örneği içerir', async () => {
    const { data } = await admin
      .from('products')
      .select('code')
      .like('code', 'ENV-%')
      .is('barcode', null);

    expect(data?.length).toBeGreaterThanOrEqual(1);
  });
});
