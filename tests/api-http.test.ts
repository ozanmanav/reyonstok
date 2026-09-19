// @vitest-environment node
import { describe, expect, inject, test } from 'vitest';

/**
 * Route handler'ların HTTP sözleşmesi ve proxy yönlendirmeleri.
 *
 * Buradaki asıl amaç güvenlik: hiçbir uç, oturum açmamış isteğe veri vermemeli.
 * Uygulama kodundaki `requireUser`/`requireRole` ile veritabanındaki RLS iki
 * ayrı savunma hattı; bu testler ilkinin gerçekten devrede olduğunu gösterir.
 *
 * Oturum açılmış senaryolar tests/api-auth.test.ts içinde.
 *
 * Sunucu tests/global-setup.ts tarafından bir kez başlatılıyor.
 */

const BASE_URL = inject('baseUrl');

/** Oturum açmamış isteğin ulaşmaması gereken tüm uçlar. */
const protectedEndpoints = [
  { method: 'GET', path: '/api/products' },
  { method: 'POST', path: '/api/products' },
  { method: 'GET', path: '/api/products/1' },
  { method: 'PATCH', path: '/api/products/1' },
  { method: 'DELETE', path: '/api/products/1' },
  { method: 'POST', path: '/api/products/1/adjust' },
  { method: 'GET', path: '/api/products/by-code?code=ENV-1001' },
  { method: 'GET', path: '/api/stock-log' },
] as const;

describe('oturum zorunluluğu', () => {
  test.for(protectedEndpoints)('$method $path oturumsuz isteği reddeder', async (endpoint) => {
    const response = await fetch(`${BASE_URL}${endpoint.path}`, {
      method: endpoint.method,
      headers: { 'content-type': 'application/json' },
      body: endpoint.method === 'GET' || endpoint.method === 'DELETE' ? undefined : '{}',
    });

    expect(response.status).toBe(401);

    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('giriş yapmanız');
  });

  test('oturumsuz istek ürün verisi sızdırmaz', async () => {
    const response = await fetch(`${BASE_URL}/api/products`);
    const text = await response.text();

    expect(text).not.toContain('ENV-1001');
    expect(text).not.toContain('products');
  });
});

describe('proxy yönlendirmeleri', () => {
  /** Yönlendirmeyi izlemeden ham yanıtı alır. */
  function requestWithoutRedirect(path: string) {
    return fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
  }

  test('oturumsuz kullanıcı ana sayfadan giriş sayfasına yönlendirilir', async () => {
    const response = await requestWithoutRedirect('/');

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toContain('/login');
  });

  test('korumalı sayfaya gitmek isteyen kullanıcı giriş sonrası oraya döner', async () => {
    const response = await requestWithoutRedirect('/products?shelf=Reyon%20A');
    const location = response.headers.get('location') ?? '';

    expect(location).toContain('/login');

    // `next` parametresi giriş sonrası hedefi taşıyor. Boşluk `+` olarak
    // kodlanabildiği için metni birebir karşılaştırmak yerine hedefi çözüyoruz.
    const next = new URL(location, BASE_URL).searchParams.get('next') ?? '';
    const target = new URL(next, BASE_URL);

    expect(target.pathname).toBe('/products');
    expect(target.searchParams.get('shelf')).toBe('Reyon A');
  });

  test('giriş sayfası oturumsuz erişilebilir', async () => {
    const response = await fetch(`${BASE_URL}/login`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Giriş yap');
  });

  test('API uçları yönlendirilmez, JSON hata döndürür', async () => {
    // Yönlendirme dönseydi istemcideki fetch çağrıları HTML alıp çökerdi.
    const response = await requestWithoutRedirect('/api/products');

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('oturumsuz kullanıcı yönetici sayfasına da erişemez', async () => {
    const response = await requestWithoutRedirect('/admin/users');

    expect(response.headers.get('location')).toContain('/login');
  });
});

describe('yanıt biçimi', () => {
  test('hatalar { error: { message } } biçiminde döner', async () => {
    const response = await fetch(`${BASE_URL}/api/stock-log`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('message');
    expect(typeof (body.error as { message: unknown }).message).toBe('string');
  });

  test('tanımsız yol 404 döner', async () => {
    const response = await fetch(`${BASE_URL}/api/bulunmayan-uc`);

    expect(response.status).toBe(404);
  });

  test('desteklenmeyen yöntem 405 döner', async () => {
    // OPTIONS dışındaki tanımsız yöntemler için Next.js otomatik 405 üretir.
    const response = await fetch(`${BASE_URL}/api/stock-log`, { method: 'DELETE' });

    expect(response.status).toBe(405);
  });
});
