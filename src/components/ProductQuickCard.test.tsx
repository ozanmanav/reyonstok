import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { StockLogWithContext } from '@/lib/repo/stock-logs';
import type { Product } from '@/lib/types';
import ProductQuickCard from './ProductQuickCard';

/**
 * Ürün kartı ve hızlı düzeltme davranışı.
 *
 * Özellikle iyimser güncelleme ve hata durumunda geri alma test ediliyor:
 * ekranda yanlış stok kalması, mağazada en pahalı hata.
 */

vi.mock('@/lib/sound', () => ({
  playBeep: vi.fn(),
  vibrate: vi.fn(),
}));

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 42,
    code: 'ENV-1001',
    barcode: '8690000000012',
    name: 'Klasik Çekiç 500g',
    category: 'El Aletleri',
    shelf_location: 'Reyon A - Raf 1',
    cost_price: 180,
    sale_price: 290,
    stock_quantity: 14,
    min_stock_alert: 4,
    is_low_stock: false,
    unit: 'Adet',
    notes: '',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
    ...overrides,
  };
}

function makeLog(overrides: Partial<StockLogWithContext> = {}): StockLogWithContext {
  return {
    id: 1,
    product_id: 42,
    user_id: 'user-1',
    change_amount: -1,
    old_stock: 15,
    new_stock: 14,
    old_price: 290,
    new_price: 290,
    type: 'stock_adjustment',
    note: '',
    created_at: '2026-09-18T18:12:00.000Z',
    product: null,
    user: { full_name: 'Ayşe Personel' },
    ...overrides,
  };
}

/**
 * Tanım listesindeki bir etiketin karşılık gelen değerini döndürür.
 *
 * Önceki sürüm `getByLabelText('Stok')` kullanıyordu ve bu testler GEÇİYORDU;
 * ancak işaretleme `<p aria-labelledby=...>` olduğu için gerçek ekran
 * okuyucularda çalışmıyordu — paragraph rolü erişilebilir ad kabul etmiyor.
 * testing-library adı kendi hesapladığı için hatayı görmüyordu.
 *
 * Artık ilişki dt/dd ile tarayıcı anlambiliminden geliyor ve test de aynı yerden
 * okuyor.
 *
 * Rol sorgusu (`getByRole('term')`) KULLANILMIYOR: tarayıcılar `<dt>`yi
 * erişilebilirlik ağacında `term` olarak eşliyor ama testing-library'nin
 * dayandığı aria-query eşlemesinde bu rol yok. Yani sorgunun başarısız olması
 * işaretlemenin yanlış olduğunu göstermiyordu; yapıdan okumak bu boşluğu aşıyor.
 */
function valueFor(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;

  if (!(value instanceof HTMLElement) || value.tagName !== 'DD') {
    throw new Error(`"${label}" etiketinin ardından <dd> bulunamadı`);
  }

  return value;
}

/** Başarılı bir düzeltme yanıtı döndüren fetch sahtesi. */
function mockAdjustSuccess(product: Product, logs: StockLogWithContext[] = []) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ product, logs }),
  });
  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ürün bilgisi gösterimi', () => {
  test('ad, fiyat, stok, reyon ve barkod görünür', () => {
    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);

    expect(screen.getByRole('heading', { name: 'Klasik Çekiç 500g' })).toBeInTheDocument();
    expect(valueFor('Satış fiyatı')).toHaveTextContent('290,00 ₺');
    expect(screen.getByText('Reyon A - Raf 1')).toBeInTheDocument();
    expect(screen.getByText('ENV-1001')).toBeInTheDocument();
    expect(screen.getByText('8690000000012')).toBeInTheDocument();
    expect(valueFor('Stok')).toHaveTextContent('14 Adet');
  });

  test('kritik stokta uyarı gösterir', () => {
    render(
      <ProductQuickCard
        product={makeProduct({ stock_quantity: 2, min_stock_alert: 5, is_low_stock: true })}
        logs={[]}
        canWrite
      />,
    );

    expect(screen.getByText(/kritik eşiğin altında/)).toBeInTheDocument();
  });

  test('tükenen üründe ayrı uyarı ve azaltma butonu kapalı', () => {
    render(
      <ProductQuickCard
        product={makeProduct({ stock_quantity: 0, is_low_stock: true })}
        logs={[]}
        canWrite
      />,
    );

    expect(screen.getByText('Bu ürün tükendi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '−1' })).toBeDisabled();
  });

  test('barkodu olmayan üründe barkod alanı gösterilmez', () => {
    render(<ProductQuickCard product={makeProduct({ barcode: null })} logs={[]} canWrite />);

    expect(screen.queryByText('8690000000012')).not.toBeInTheDocument();
  });
});

describe('yetki', () => {
  test('görüntüleyici rolünde düzeltme bölümü gösterilmez', () => {
    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite={false} />);

    expect(screen.queryByRole('button', { name: '−1' })).not.toBeInTheDocument();
    expect(screen.getByText(/Yetkiniz görüntüleme ile sınırlı/)).toBeInTheDocument();
  });
});

describe('hızlı stok düzeltme', () => {
  test('azaltma isteği doğru gövdeyle gönderilir', async () => {
    const fetchMock = mockAdjustSuccess(makeProduct({ stock_quantity: 13 }));

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.click(screen.getByRole('button', { name: '−1' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/products/42/adjust',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.stockDelta).toBe(-1);
  });

  test('stok sunucu yanıtını beklemeden düşer (iyimser güncelleme)', async () => {
    // Yanıtı geciktirip arada ekranı kontrol ediyoruz.
    let releaseResponse: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        await pending;

        return {
          ok: true,
          json: async () => ({ product: makeProduct({ stock_quantity: 13 }), logs: [] }),
        };
      }),
    );

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.click(screen.getByRole('button', { name: '−1' }));

    // Sunucu daha yanıt vermedi ama ekranda 13 görünmeli.
    await waitFor(() => {
      expect(valueFor('Stok')).toHaveTextContent('13 Adet');
    });

    releaseResponse();
  });

  test('hata durumunda stok eski değerine döner ve mesaj gösterilir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Bu işlem için yetkiniz yok' } }),
      }),
    );

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.click(screen.getByRole('button', { name: '−1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Bu işlem için yetkiniz yok');
    // Geri alma: stok 14'e dönmeli.
    expect(valueFor('Stok')).toHaveTextContent('14 Adet');
  });

  test('ağ hatasında da geri alınır', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Bağlantı kesildi')));

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.click(screen.getByRole('button', { name: '+1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Bağlantı kesildi');
    expect(valueFor('Stok')).toHaveTextContent('14 Adet');
  });

  test('sunucudan dönen değer iyimser tahminin üstüne yazılır', async () => {
    // Başka bir personel aynı anda stok düşürmüş olabilir; doğru olan sunucu değeri.
    mockAdjustSuccess(makeProduct({ stock_quantity: 9 }));

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.click(screen.getByRole('button', { name: '−1' }));

    await waitFor(() => {
      expect(valueFor('Stok')).toHaveTextContent('9 Adet');
    });
  });
});

describe('sayım', () => {
  test('girilen adet kesin değer olarak gönderilir', async () => {
    const fetchMock = mockAdjustSuccess(makeProduct({ stock_quantity: 8 }));

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.type(screen.getByLabelText('Sayılan adet'), '8');
    await userEvent.click(screen.getAllByRole('button', { name: 'Kaydet' })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.absoluteStock).toBe(8);
    expect(body.stockDelta).toBeUndefined();
  });

  test('ondalıklı sayım reddedilir ve istek gönderilmez', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.type(screen.getByLabelText('Sayılan adet'), '3,5');
    await userEvent.click(screen.getAllByRole('button', { name: 'Kaydet' })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('tam sayı olmalı');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('sıfır sayım kabul edilir', async () => {
    const fetchMock = mockAdjustSuccess(makeProduct({ stock_quantity: 0 }));

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.type(screen.getByLabelText('Sayılan adet'), '0');
    await userEvent.click(screen.getAllByRole('button', { name: 'Kaydet' })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.absoluteStock).toBe(0);
  });
});

describe('fiyat güncelleme', () => {
  test('virgüllü fiyat kabul edilir ve sayıya çevrilir', async () => {
    // Türkçe klavyede ondalık ayırıcı virgül; nokta beklemek kullanımı bozar.
    const fetchMock = mockAdjustSuccess(makeProduct({ sale_price: 24.5 }));

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.type(screen.getByLabelText('Yeni satış fiyatı'), '24,50');
    await userEvent.click(screen.getAllByRole('button', { name: 'Kaydet' })[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.newSalePrice).toBe(24.5);
  });

  test('ikiden fazla ondalık basamak reddedilir', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.type(screen.getByLabelText('Yeni satış fiyatı'), '24,567');
    await userEvent.click(screen.getAllByRole('button', { name: 'Kaydet' })[1]);

    expect(await screen.findByRole('alert')).toHaveTextContent('iki ondalık basamak');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('geçersiz fiyat reddedilir', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    await userEvent.type(screen.getByLabelText('Yeni satış fiyatı'), 'abc');
    await userEvent.click(screen.getAllByRole('button', { name: 'Kaydet' })[1]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Geçerli bir fiyat girin');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('hareket listesi', () => {
  test('hareket yoksa bilgi mesajı gösterir', () => {
    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);

    expect(screen.getByText('Henüz hareket kaydı yok.')).toBeInTheDocument();
  });

  test('hareketi açıklama, saat ve kullanıcı adıyla listeler', () => {
    render(<ProductQuickCard product={makeProduct()} logs={[makeLog()]} canWrite />);

    expect(screen.getByText('Stok azaltıldı (15 → 14)')).toBeInTheDocument();
    // Saat dilimi sabit: UTC 18:12 -> 21:12.
    expect(screen.getByText(/21:12/)).toBeInTheDocument();
    expect(screen.getByText(/Ayşe Personel/)).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  test('kullanıcı adı okunamıyorsa nötr ifade gösterir', () => {
    // RLS gereği personel başkasının profilini okuyamıyor.
    render(<ProductQuickCard product={makeProduct()} logs={[makeLog({ user: null })]} canWrite />);

    expect(screen.getByText(/Personel/)).toBeInTheDocument();
  });

  test('fiyat güncellemesini yeni fiyatla gösterir', () => {
    render(
      <ProductQuickCard
        product={makeProduct()}
        logs={[
          makeLog({
            type: 'price_update',
            change_amount: 0,
            old_price: 290,
            new_price: 310,
          }),
        ]}
        canWrite
      />,
    );

    expect(screen.getByText('Fiyat güncellendi')).toBeInTheDocument();
    expect(screen.getByText('310,00 ₺')).toBeInTheDocument();
  });

  test('ilk kayıt hareketini açıklar', () => {
    render(
      <ProductQuickCard
        product={makeProduct()}
        logs={[makeLog({ type: 'initial_count', change_amount: 14, old_stock: 0, new_stock: 14 })]}
        canWrite
      />,
    );

    expect(screen.getByText('İlk kayıt')).toBeInTheDocument();
    expect(screen.getByText('+14')).toBeInTheDocument();
  });

  test('güncelleme sonrası hareket listesi tazelenir', async () => {
    mockAdjustSuccess(makeProduct({ stock_quantity: 13 }), [
      makeLog({ id: 99, change_amount: -1, old_stock: 14, new_stock: 13 }),
    ]);

    render(<ProductQuickCard product={makeProduct()} logs={[]} canWrite />);
    expect(screen.getByText('Henüz hareket kaydı yok.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '−1' }));

    expect(await screen.findByText('Stok azaltıldı (14 → 13)')).toBeInTheDocument();
  });
});
