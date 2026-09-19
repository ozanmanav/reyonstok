import { describe, expect, test } from 'vitest';
import {
  adjustStockSchema,
  createProductSchema,
  formatValidationError,
  updateProductSchema,
} from './validation';

/** Geçerli bir ürün gövdesinin üzerine değişiklik uygulayan yardımcı. */
function productBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Ürünü',
    shelf_location: 'Reyon A - Raf 1',
    sale_price: 24.5,
    ...overrides,
  };
}

describe('createProductSchema', () => {
  test('geçerli gövdeyi kabul eder ve boşlukları kırpar', () => {
    const result = createProductSchema.parse(
      productBody({ name: '  Çekiç  ', shelf_location: ' Reyon A ' })
    );

    expect(result.name).toBe('Çekiç');
    expect(result.shelf_location).toBe('Reyon A');
  });

  test('ürün adı zorunlu', () => {
    const result = createProductSchema.safeParse(productBody({ name: '   ' }));

    expect(result.success).toBe(false);
    expect(formatValidationError(result.error!)).toContain('Ürün adı zorunlu');
  });

  test('reyon konumu zorunlu', () => {
    const result = createProductSchema.safeParse(productBody({ shelf_location: '' }));

    expect(result.success).toBe(false);
    expect(formatValidationError(result.error!)).toContain('Reyon veya raf konumu zorunlu');
  });

  test('satış fiyatı zorunlu', () => {
    const withoutPrice = { name: 'Test Ürünü', shelf_location: 'Reyon A - Raf 1' };

    expect(createProductSchema.safeParse(withoutPrice).success).toBe(false);
  });

  test('negatif fiyat reddedilir', () => {
    const result = createProductSchema.safeParse(productBody({ sale_price: -1 }));

    expect(result.success).toBe(false);
    expect(formatValidationError(result.error!)).toContain('negatif olamaz');
  });

  test('ikiden fazla ondalık basamaklı fiyat reddedilir', () => {
    // numeric(12,2) sessizce yuvarlardı; kullanıcının girdiği değer değişmesin.
    const result = createProductSchema.safeParse(productBody({ sale_price: 24.567 }));

    expect(result.success).toBe(false);
    expect(formatValidationError(result.error!)).toContain('iki ondalık basamak');
  });

  test('iki ondalık basamaklı fiyat kabul edilir', () => {
    expect(createProductSchema.safeParse(productBody({ sale_price: 24.55 })).success).toBe(true);
    expect(createProductSchema.safeParse(productBody({ sale_price: 0 })).success).toBe(true);
    expect(createProductSchema.safeParse(productBody({ sale_price: 1999.9 })).success).toBe(true);
  });

  test('ondalıklı stok adedi reddedilir', () => {
    const result = createProductSchema.safeParse(productBody({ stock_quantity: 1.5 }));

    expect(result.success).toBe(false);
    expect(formatValidationError(result.error!)).toContain('tam sayı');
  });

  test('negatif stok adedi reddedilir', () => {
    expect(createProductSchema.safeParse(productBody({ stock_quantity: -3 })).success).toBe(false);
  });

  test('geçerli EAN-13 barkodu kabul edilir', () => {
    expect(
      createProductSchema.safeParse(productBody({ barcode: '4006381333931' })).success
    ).toBe(true);
  });

  test('kontrol hanesi hatalı EAN-13 reddedilir', () => {
    const result = createProductSchema.safeParse(productBody({ barcode: '4006381333932' }));

    expect(result.success).toBe(false);
    expect(formatValidationError(result.error!)).toContain('kontrol hanesi hatalı');
  });

  test('EAN-13 dışındaki barkod biçimleri olduğu gibi kabul edilir', () => {
    // Mağazada UPC-A (12 hane), EAN-8 ve Code-128 etiketli ürünler olabilir.
    expect(createProductSchema.safeParse(productBody({ barcode: '96385074' })).success).toBe(true);
    expect(createProductSchema.safeParse(productBody({ barcode: '012345678905' })).success).toBe(
      true
    );
    expect(createProductSchema.safeParse(productBody({ barcode: 'ABC-123-XYZ' })).success).toBe(
      true
    );
  });

  test('barkod boş dize veya null olabilir', () => {
    expect(createProductSchema.safeParse(productBody({ barcode: '' })).success).toBe(true);
    expect(createProductSchema.safeParse(productBody({ barcode: null })).success).toBe(true);
  });

  test('aşırı uzun metinler reddedilir', () => {
    expect(createProductSchema.safeParse(productBody({ name: 'a'.repeat(201) })).success).toBe(
      false
    );
    expect(
      createProductSchema.safeParse(productBody({ shelf_location: 'a'.repeat(121) })).success
    ).toBe(false);
  });
});

describe('updateProductSchema', () => {
  test('tek alanlı yamayı kabul eder', () => {
    const result = updateProductSchema.parse({ sale_price: 10 });

    expect(result).toEqual({ sale_price: 10 });
  });

  test('boş yamayı kabul eder', () => {
    expect(updateProductSchema.parse({})).toEqual({});
  });

  test('geçersiz değeri yamada da reddeder', () => {
    expect(updateProductSchema.safeParse({ sale_price: -5 }).success).toBe(false);
  });
});

describe('adjustStockSchema', () => {
  test('göreli değişimi kabul eder', () => {
    expect(adjustStockSchema.parse({ stockDelta: -1 })).toEqual({ stockDelta: -1 });
  });

  test('sayılan adedi kabul eder', () => {
    expect(adjustStockSchema.parse({ absoluteStock: 12 })).toEqual({ absoluteStock: 12 });
  });

  test('yalnızca fiyat güncellemesini kabul eder', () => {
    expect(adjustStockSchema.parse({ newSalePrice: 19.9 })).toEqual({ newSalePrice: 19.9 });
  });

  test('değişim ve sayılan adet birlikte gönderilemez', () => {
    const result = adjustStockSchema.safeParse({ stockDelta: -1, absoluteStock: 5 });

    expect(result.success).toBe(false);
    expect(formatValidationError(result.error!)).toContain('birlikte gönderilemez');
  });

  test('hiçbir değer gönderilmediğinde reddedilir', () => {
    const result = adjustStockSchema.safeParse({ note: 'sadece not' });

    expect(result.success).toBe(false);
    expect(formatValidationError(result.error!)).toContain('Güncellenecek bir değer');
  });

  test('sayılan adet negatif olamaz', () => {
    expect(adjustStockSchema.safeParse({ absoluteStock: -1 }).success).toBe(false);
  });

  test('ondalıklı değişim reddedilir', () => {
    expect(adjustStockSchema.safeParse({ stockDelta: -1.5 }).success).toBe(false);
  });
});

describe('formatValidationError', () => {
  test('alan adını mesajın önüne ekler', () => {
    const result = createProductSchema.safeParse(productBody({ sale_price: -1 }));

    expect(formatValidationError(result.error!)).toMatch(/^sale_price: /);
  });

  test('birden fazla hatayı birleştirir', () => {
    const result = createProductSchema.safeParse({ name: '', shelf_location: '', sale_price: -1 });
    const message = formatValidationError(result.error!);

    expect(message.split(';').length).toBeGreaterThanOrEqual(3);
  });
});
