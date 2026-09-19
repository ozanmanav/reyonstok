import { describe, expect, test } from 'vitest';
import { ApiError, handleRoute, parseId, readJsonBody } from './api';
import { createProductSchema } from './validation';

/** Postgres/PostgREST hata nesnesinin testte kullanılan sadeleştirilmiş hali. */
function dbError(code: string, message = '', details: string | null = null) {
  return { code, message, details };
}

async function statusAndMessage(error: unknown) {
  const response = await handleRoute(async () => {
    throw error;
  });
  const body = (await response.json()) as { error?: { message?: string } };

  return { status: response.status, message: body.error?.message ?? '' };
}

describe('parseId', () => {
  test('geçerli kimliği sayıya çevirir', () => {
    expect(parseId('42')).toBe(42);
  });

  test('sayı olmayan, sıfır, negatif ve ondalıklı değerleri reddeder', () => {
    for (const value of ['abc', '0', '-1', '1.5', '', ' ']) {
      expect(() => parseId(value), `reddedilmeliydi: ${JSON.stringify(value)}`).toThrow(ApiError);
    }
  });
});

describe('readJsonBody', () => {
  test('geçerli JSON gövdesini okur', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });

    expect(await readJsonBody(request)).toEqual({ a: 1 });
  });

  test('bozuk gövdede anlaşılır hata verir', async () => {
    const request = new Request('http://localhost/test', { method: 'POST', body: '{bozuk' });

    await expect(readJsonBody(request)).rejects.toThrow('geçerli JSON değil');
  });
});

describe('handleRoute hata çevirisi', () => {
  test('ApiError durum kodunu ve mesajını korur', async () => {
    const result = await statusAndMessage(new ApiError(404, 'Ürün bulunamadı'));

    expect(result).toEqual({ status: 404, message: 'Ürün bulunamadı' });
  });

  test('doğrulama hatasını 400 olarak döndürür', async () => {
    const parsed = createProductSchema.safeParse({ name: '', shelf_location: '', sale_price: -1 });
    const result = await statusAndMessage(parsed.error);

    expect(result.status).toBe(400);
    expect(result.message).toContain('Ürün adı zorunlu');
  });

  test('barkod çakışmasını 409 ve alana özgü mesajla döndürür', async () => {
    const result = await statusAndMessage(
      dbError('23505', 'duplicate key value violates unique constraint "products_barcode_key"')
    );

    expect(result).toEqual({ status: 409, message: 'Bu barkod başka bir üründe kayıtlı' });
  });

  test('ürün kodu çakışmasını 409 ve alana özgü mesajla döndürür', async () => {
    const result = await statusAndMessage(
      dbError('23505', 'duplicate key value violates unique constraint "products_code_key"')
    );

    expect(result).toEqual({ status: 409, message: 'Bu ürün kodu başka bir üründe kayıtlı' });
  });

  test('yetki reddini 403 olarak döndürür', async () => {
    const result = await statusAndMessage(dbError('42501', 'permission denied'));

    expect(result).toEqual({ status: 403, message: 'Bu işlem için yetkiniz yok' });
  });

  test('kayıt bulunamadı hatasını 404 olarak döndürür', async () => {
    const result = await statusAndMessage(dbError('P0002', 'Ürün bulunamadı (id: 5)'));

    expect(result.status).toBe(404);
  });

  test('check kısıtı ihlalini 400 ve anlaşılır mesajla döndürür', async () => {
    const result = await statusAndMessage(
      dbError('23514', 'violates check constraint "products_stock_non_negative"')
    );

    expect(result).toEqual({ status: 400, message: 'Stok adedi negatif olamaz' });
  });

  test('büyük harf kısıtı ihlalini açıklar', async () => {
    const result = await statusAndMessage(
      dbError('23514', 'violates check constraint "products_code_uppercase"')
    );

    expect(result.message).toBe('Ürün kodu büyük harf olmalı');
  });

  test('zorunlu alan ihlalini 400 olarak döndürür', async () => {
    const result = await statusAndMessage(dbError('23502', 'null value in column "name"'));

    expect(result.status).toBe(400);
  });

  test('bilinmeyen hatada ayrıntı sızdırmaz', async () => {
    const result = await statusAndMessage(
      new Error('veritabanı parolası pg://gizli@host reddedildi')
    );

    expect(result.status).toBe(500);
    expect(result.message).toBe('İşlem sırasında beklenmeyen bir hata oluştu');
    expect(result.message).not.toContain('gizli');
  });

  test('başarılı yanıtı olduğu gibi geçirir', async () => {
    const response = await handleRoute(async () => Response.json({ ok: true }, { status: 201 }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
  });
});
