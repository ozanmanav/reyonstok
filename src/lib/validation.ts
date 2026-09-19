import { z } from 'zod';
import { isValidEan13 } from './scan-code';

/**
 * HTTP sınırındaki girdi doğrulamaları.
 *
 * Veritabanı kısıtları son savunma hattı; burada amaç kullanıcıya anlaşılır
 * Türkçe hata mesajı döndürmek ve veritabanına hiç gitmeden hatalı isteği
 * kesmek.
 */

/**
 * Para alanı: negatif olamaz ve en fazla iki ondalık basamak taşıyabilir.
 * Veritabanı numeric(12,2) olduğu için fazla basamak sessizce yuvarlanır;
 * kullanıcının girdiği değerin değişmesini önlemek için baştan reddediyoruz.
 */
const money = z
  .number({ error: 'Geçerli bir tutar girin' })
  .min(0, 'Tutar negatif olamaz')
  .max(9_999_999_999, 'Tutar çok büyük')
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: 'Tutar en fazla iki ondalık basamak içerebilir (örn. 24,50)',
  });

const quantity = z
  .number({ error: 'Geçerli bir adet girin' })
  .int('Adet tam sayı olmalı')
  .min(0, 'Adet negatif olamaz')
  .max(1_000_000, 'Adet çok büyük');

/**
 * Barkod alanı.
 *
 * Tam 13 haneli sayısal değerlerde EAN-13 kontrol hanesi doğrulanır; böylece
 * elle giriş hatası yakalanır. Diğer biçimler (UPC-A, EAN-8, Code-128) olduğu
 * gibi kabul edilir, çünkü mağazada bu biçimlerde ürün olabilir.
 */
const barcode = z
  .string()
  .trim()
  .max(64, 'Barkod çok uzun')
  .refine((value) => !/^\d{13}$/.test(value) || isValidEan13(value), {
    message: 'EAN-13 barkodunun kontrol hanesi hatalı, okunan değeri kontrol edin',
  });

export const createProductSchema = z.object({
  code: z.string().trim().min(1, 'Ürün kodu boş olamaz').max(64, 'Ürün kodu çok uzun').optional(),
  // Boş dize gönderilebilir: formda barkod alanı temizlendiğinde null'a çevrilir.
  barcode: barcode.or(z.literal('')).nullish(),
  name: z.string().trim().min(1, 'Ürün adı zorunlu').max(200, 'Ürün adı çok uzun'),
  category: z.string().trim().max(100, 'Kategori adı çok uzun').optional(),
  shelf_location: z
    .string()
    .trim()
    .min(1, 'Reyon veya raf konumu zorunlu')
    .max(120, 'Reyon adı çok uzun'),
  cost_price: money.optional(),
  sale_price: money,
  stock_quantity: quantity.optional(),
  min_stock_alert: quantity.optional(),
  unit: z.string().trim().max(40, 'Birim çok uzun').optional(),
  notes: z.string().trim().max(1000, 'Not çok uzun').optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const adjustStockSchema = z
  .object({
    stockDelta: z
      .number({ error: 'Geçerli bir değişim girin' })
      .int('Değişim tam sayı olmalı')
      .min(-1_000_000)
      .max(1_000_000)
      .optional(),
    absoluteStock: quantity.optional(),
    newSalePrice: money.optional(),
    note: z.string().trim().max(500, 'Not çok uzun').optional(),
  })
  .refine((value) => value.stockDelta === undefined || value.absoluteStock === undefined, {
    message: 'Stok değişimi ile sayılan adet birlikte gönderilemez',
  })
  .refine(
    (value) =>
      value.stockDelta !== undefined ||
      value.absoluteStock !== undefined ||
      value.newSalePrice !== undefined,
    { message: 'Güncellenecek bir değer gönderilmedi' }
  );

export type CreateProductBody = z.infer<typeof createProductSchema>;
export type UpdateProductBody = z.infer<typeof updateProductSchema>;
export type AdjustStockBody = z.infer<typeof adjustStockSchema>;

/**
 * Doğrulama hatalarını kullanıcıya gösterilebilir tek bir metne indirir.
 * Alan adı yerine mesajın kendisi öne çıkar, çünkü mesajlar Türkçe ve açıklayıcı.
 */
export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');

      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
