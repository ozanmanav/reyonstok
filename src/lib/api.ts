import { ZodError } from 'zod';
import { formatValidationError } from './validation';

/**
 * Route handler'lar için ortak yanıt ve hata çevirisi.
 *
 * Veritabanından gelen teknik hatalar (unique violation, RLS reddi) kullanıcıya
 * doğrudan gösterilemez; burada hem doğru HTTP durum kodu hem anlaşılır Türkçe
 * mesaj üretiliyor.
 */

/** Bilinçli olarak üretilen, kullanıcıya gösterilebilir hata. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function errorResponse(message: string, status: number): Response {
  return Response.json({ error: { message } }, { status });
}

/** Postgres hata kodları (PostgREST bunları olduğu gibi aktarıyor). */
const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';
const PG_NOT_NULL_VIOLATION = '23502';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_INSUFFICIENT_PRIVILEGE = '42501';
const PG_NO_DATA_FOUND = 'P0002';
const PG_INVALID_PARAMETER = '22023';

/**
 * Route handler gövdesini sarar; beklenmeyen hataları sunucu günlüğüne yazıp
 * istemciye ayrıntı sızdırmadan yanıt döndürür.
 */
export async function handleRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return translateError(error);
  }
}

function translateError(error: unknown): Response {
  if (error instanceof ApiError) {
    return errorResponse(error.message, error.status);
  }

  if (error instanceof ZodError) {
    return errorResponse(formatValidationError(error), 400);
  }

  const dbError = asDatabaseError(error);
  if (dbError) {
    switch (dbError.code) {
      case PG_UNIQUE_VIOLATION:
        return errorResponse(describeUniqueViolation(dbError), 409);

      case PG_CHECK_VIOLATION:
        return errorResponse(describeCheckViolation(dbError), 400);

      case PG_NOT_NULL_VIOLATION:
        return errorResponse('Zorunlu bir alan boş bırakıldı', 400);

      case PG_FOREIGN_KEY_VIOLATION:
        return errorResponse('İlişkili kayıt bulunamadı', 400);

      case PG_INSUFFICIENT_PRIVILEGE:
        return errorResponse('Bu işlem için yetkiniz yok', 403);

      case PG_NO_DATA_FOUND:
        return errorResponse('Kayıt bulunamadı', 404);

      case PG_INVALID_PARAMETER:
        return errorResponse(dbError.message, 400);

      default:
        break;
    }
  }

  // Beklenmeyen hata: ayrıntı yalnızca sunucu günlüğünde kalsın.
  console.error('Beklenmeyen route handler hatası:', error);

  return errorResponse('İşlem sırasında beklenmeyen bir hata oluştu', 500);
}

interface DatabaseError {
  code: string;
  message: string;
  details?: string | null;
}

function asDatabaseError(error: unknown): DatabaseError | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };

  if (typeof candidate.code !== 'string') {
    return null;
  }

  return {
    code: candidate.code,
    message: typeof candidate.message === 'string' ? candidate.message : '',
    details: typeof candidate.details === 'string' ? candidate.details : null,
  };
}

/** Hangi alanın çakıştığını kullanıcıya söyleyebilmek için kısıt adına bakıyoruz. */
function describeUniqueViolation(error: DatabaseError): string {
  const haystack = `${error.message} ${error.details ?? ''}`;

  if (haystack.includes('barcode')) {
    return 'Bu barkod başka bir üründe kayıtlı';
  }

  if (haystack.includes('code')) {
    return 'Bu ürün kodu başka bir üründe kayıtlı';
  }

  return 'Bu kayıt zaten mevcut';
}

function describeCheckViolation(error: DatabaseError): string {
  const haystack = `${error.message} ${error.details ?? ''}`;

  if (haystack.includes('products_code_uppercase')) {
    return 'Ürün kodu büyük harf olmalı';
  }

  if (haystack.includes('stock_non_negative')) {
    return 'Stok adedi negatif olamaz';
  }

  if (haystack.includes('price_non_negative')) {
    return 'Fiyat negatif olamaz';
  }

  if (haystack.includes('not_blank')) {
    return 'Zorunlu bir alan boş bırakıldı';
  }

  return 'Girilen değerler kabul edilmedi';
}

/** Yol parametresindeki kimliği doğrular. */
export function parseId(value: string): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'Geçersiz ürün kimliği');
  }

  return id;
}

/** İstek gövdesini JSON olarak okur; bozuk gövdede anlaşılır hata verir. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'İstek gövdesi geçerli JSON değil');
  }
}
