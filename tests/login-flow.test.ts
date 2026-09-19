// @vitest-environment node
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { createTestUser, deleteTestUser, type TestUser } from './helpers/supabase';

/**
 * Giriş formunun gerçek gönderimi.
 *
 * Uygulamanın giriş kapısı burası; çalışmazsa hiçbir ekran kullanılamaz. Form
 * bir Server Action'a bağlı ve Next.js ilerlemeli iyileştirme (JS kapalı)
 * desteği için forma gizli alanlar basıyor. Test, tarayıcının JS olmadan
 * yapacağı gönderimi birebir tekrarlıyor: sayfadaki gizli alanları olduğu gibi
 * toplayıp üzerine e-posta ve şifreyi ekliyor.
 *
 * Alan adları varsayılmıyor (`$ACTION_...` gibi iç isimlere bağımlı değil);
 * sayfada ne varsa geri gönderiliyor.
 */

const BASE_URL = inject('baseUrl');

let staffUser: TestUser;

beforeAll(async () => {
  staffUser = await createTestUser('staff');
}, 60_000);

afterAll(async () => {
  if (staffUser) {
    await deleteTestUser(staffUser);
  }
});

/** Giriş sayfasındaki gizli form alanlarını okur. */
async function readHiddenFields(): Promise<{ name: string; value: string }[]> {
  const html = await (await fetch(`${BASE_URL}/login`)).text();

  return [...html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\s*\/>/g)].map(
    ([, name, value = '']) => ({
      name,
      // HTML öznitelik kaçışlarını geri çevir.
      value: value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'"),
    })
  );
}

/** Giriş formunu JS'siz tarayıcı gibi gönderir. */
async function submitLogin(email: string, password: string): Promise<Response> {
  const form = new FormData();

  for (const field of await readHiddenFields()) {
    form.append(field.name, field.value);
  }

  form.append('email', email);
  form.append('password', password);

  return fetch(`${BASE_URL}/login`, { method: 'POST', body: form, redirect: 'manual' });
}

describe('giriş formu', () => {
  test('sayfa e-posta ve şifre alanlarını sunar', async () => {
    const html = await (await fetch(`${BASE_URL}/login`)).text();

    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('Giriş yap');
  });

  test('doğru bilgilerle giriş oturum çerezi yazar ve ana sayfaya yönlendirir', async () => {
    const response = await submitLogin(staffUser.email, staffUser.password);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');

    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.join(' ')).toContain('-auth-token');
  });

  test('yazılan çerezle korumalı sayfa açılır', async () => {
    const login = await submitLogin(staffUser.email, staffUser.password);
    const cookieHeader = login.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

    const response = await fetch(`${BASE_URL}/`, {
      headers: { cookie: cookieHeader },
      redirect: 'manual',
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Çıkış');
  });

  test('oturum çerezi httpOnly ve SameSite korumalı yazılır', async () => {
    const response = await submitLogin(staffUser.email, staffUser.password);
    const authCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.includes('-auth-token'))
      ?.toLowerCase();

    expect(authCookie).toBeDefined();

    // httpOnly, @supabase/ssr varsayılanı DEĞİL; uygulamada tarayıcı Supabase'e
    // doğrudan bağlanmadığı için açıkça kapatıyoruz. Bir XSS oluşsa bile oturum
    // belirteci JavaScript ile okunamaz.
    expect(authCookie).toContain('httponly');
    expect(authCookie).toContain('samesite=lax');
    expect(authCookie).toContain('path=/');
  });

  test('hatalı şifrede oturum açılmaz ve hata mesajı gösterilir', async () => {
    const response = await submitLogin(staffUser.email, 'kesinlikle-yanlis-sifre');

    // Yönlendirme yok: form hatayla yeniden çizilir.
    expect(response.status).toBe(200);

    const authCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.includes('-auth-token'));
    expect(authCookie).toBeUndefined();

    expect(await response.text()).toContain('E-posta veya şifre hatalı');
  });

  test('bilinmeyen e-postada aynı nötr mesaj döner', async () => {
    // Farklı mesaj vermek, hangi e-postaların kayıtlı olduğunu sızdırırdı.
    const response = await submitLogin('bulunmayan@reyonstok.test', 'herhangi-bir-sifre');

    expect(await response.text()).toContain('E-posta veya şifre hatalı');
  });

  test('eksik alanlarda doğrulama mesajı döner', async () => {
    const response = await submitLogin('', '');

    expect(await response.text()).toContain('zorunlu');
  });

  test('geçersiz e-posta biçimi reddedilir', async () => {
    const response = await submitLogin('eposta-degil', 'bir-sifre');

    expect(await response.text()).toContain('Geçerli bir e-posta adresi girin');
  });
});
