import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import BarcodeScanner from './BarcodeScanner';

/**
 * Tarayıcı bileşeninin kamera olmadan da kullanılabilir kalmasını doğrular.
 *
 * jsdom'da gerçek kamera ve görüntü çözümleme yok; bu yüzden burada kamera
 * hatalarının doğru mesaja dönüşmesi, elle giriş ve yineleme engeli test ediliyor.
 * Gerçek kamera akışıyla okuma cihazda elle doğrulanacak.
 */

/** Ses ve titreşim jsdom'da yok; çağrıları sessizleştiriyoruz. */
vi.mock('@/lib/sound', () => ({
  playBeep: vi.fn(),
  vibrate: vi.fn(),
}));

/** Kamerayı belirli bir hatayla reddeden ortam kurar. */
function mockCameraRejection(errorName: string) {
  const error = new Error('kamera yok');
  error.name = errorName;

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockRejectedValue(error) },
  });
}

beforeEach(() => {
  // jsdom varsayılan olarak güvenli bağlam bildirmiyor; kamera yolunu test
  // edebilmek için açıkça ayarlıyoruz.
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('kamera hataları', () => {
  test('izin verilmediğinde açıklayıcı mesaj ve elle giriş gösterir', async () => {
    mockCameraRejection('NotAllowedError');

    render(<BarcodeScanner onScan={vi.fn()} />);

    expect(await screen.findByText('Kamera izni verilmedi')).toBeInTheDocument();
    // Kamera yoksa personel işe devam edebilsin.
    expect(await screen.findByLabelText('Ürün kodu veya barkod')).toBeInTheDocument();
  });

  test('kamera bulunamadığında uygun mesaj gösterir', async () => {
    mockCameraRejection('NotFoundError');

    render(<BarcodeScanner onScan={vi.fn()} />);

    expect(await screen.findByText('Kamera bulunamadı')).toBeInTheDocument();
  });

  test('bilinmeyen hatada genel mesaj gösterir', async () => {
    mockCameraRejection('AbortError');

    render(<BarcodeScanner onScan={vi.fn()} />);

    expect(await screen.findByText('Kamera başlatılamadı')).toBeInTheDocument();
  });

  test('güvensiz bağlantıda HTTPS uyarısı verir ve adres gömmez', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });

    render(<BarcodeScanner onScan={vi.fn()} />);

    expect(await screen.findByText('Güvenli bağlantı gerekiyor')).toBeInTheDocument();
    // Uyarı metni sabit bir adres içermemeli; ortama göre değişen bir şeyi
    // koda gömmek prototipte soruna yol açmıştı.
    expect(screen.queryByText(/https:\/\/[a-z0-9.-]+/i)).not.toBeInTheDocument();
  });
});

describe('elle kod girişi', () => {
  beforeEach(() => {
    mockCameraRejection('NotAllowedError');
  });

  test('girilen ürün kodunu çözümleyip bildirir', async () => {
    const onScan = vi.fn();
    render(<BarcodeScanner onScan={onScan} />);

    const input = await screen.findByLabelText('Ürün kodu veya barkod');
    await userEvent.type(input, 'env-1001');
    await userEvent.click(screen.getByRole('button', { name: 'Ara' }));

    expect(onScan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'qr', code: 'ENV-1001' }));
  });

  test('EAN-13 barkodunu doğrulanmış olarak bildirir', async () => {
    const onScan = vi.fn();
    render(<BarcodeScanner onScan={onScan} />);

    const input = await screen.findByLabelText('Ürün kodu veya barkod');
    await userEvent.type(input, '4006381333931');
    await userEvent.click(screen.getByRole('button', { name: 'Ara' }));

    expect(onScan).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ean13', code: '4006381333931' }),
    );
  });

  test('boş girişte hata gösterir ve bildirim yapmaz', async () => {
    const onScan = vi.fn();
    render(<BarcodeScanner onScan={onScan} />);

    await screen.findByLabelText('Ürün kodu veya barkod');
    await userEvent.click(screen.getByRole('button', { name: 'Ara' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Geçerli bir kod veya barkod girin');
    expect(onScan).not.toHaveBeenCalled();
  });

  test('aynı kod elle tekrar arandığında yineleme engeline takılmaz', async () => {
    // Kamera aynı etikete bakarken yinelemeyi engelliyoruz, ama kullanıcı elle
    // aynı kodu tekrar aradıysa bunu bilerek yapıyor.
    const onScan = vi.fn();
    render(<BarcodeScanner onScan={onScan} />);

    const input = await screen.findByLabelText('Ürün kodu veya barkod');

    await userEvent.type(input, 'ENV-1001');
    await userEvent.click(screen.getByRole('button', { name: 'Ara' }));
    await userEvent.type(input, 'ENV-1001');
    await userEvent.click(screen.getByRole('button', { name: 'Ara' }));

    expect(onScan).toHaveBeenCalledTimes(2);
  });

  test('gönderim sonrası alan temizlenir', async () => {
    render(<BarcodeScanner onScan={vi.fn()} />);

    const input = await screen.findByLabelText('Ürün kodu veya barkod');
    await userEvent.type(input, 'ENV-1001');
    await userEvent.click(screen.getByRole('button', { name: 'Ara' }));

    expect(input).toHaveValue('');
  });
});

describe('duraklatma', () => {
  test('paused durumunda kamera hiç açılmaz', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    render(<BarcodeScanner onScan={vi.fn()} paused />);

    await waitFor(() => {
      expect(getUserMedia).not.toHaveBeenCalled();
    });
  });

  test('kamera istenen yönle açılır', async () => {
    // Reyon etiketi okunacağı için arka kamera istenmeli.
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    render(<BarcodeScanner onScan={vi.fn()} />);

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        }),
      );
    });
  });
});
