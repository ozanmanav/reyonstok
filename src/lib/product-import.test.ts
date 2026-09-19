import { describe, expect, test } from 'vitest';
import { parseCsv } from './csv';
import {
  detectColumnMapping,
  missingRequiredFields,
  normalizeHeader,
  parseImportRows,
  parseNumericCell,
} from './product-import';

describe('normalizeHeader', () => {
  test('Türkçe karakterleri ve noktalamayı sadeleştirir', () => {
    expect(normalizeHeader('Ürün Adı')).toBe('urun adi');
    expect(normalizeHeader('URUN_ADI')).toBe('urun adi');
    expect(normalizeHeader('  Satış   Fiyatı  ')).toBe('satis fiyati');
    expect(normalizeHeader('Reyon/Raf')).toBe('reyon/raf');
    expect(normalizeHeader('Kritik-Stok')).toBe('kritik stok');
  });

  test('büyük İ harfini doğru küçültür', () => {
    // Türkçe'de I/İ dönüşümü İngilizce ile aynı değil.
    expect(normalizeHeader('İĞNE')).toBe('igne');
  });
});

describe('detectColumnMapping', () => {
  test('Türkçe başlıkları eşleştirir', () => {
    const mapping = detectColumnMapping([
      'Ürün Kodu',
      'Barkod',
      'Ürün Adı',
      'Kategori',
      'Reyon',
      'Alış Fiyatı',
      'Satış Fiyatı',
      'Stok',
      'Kritik Stok',
      'Birim',
      'Notlar',
    ]);

    expect(mapping).toEqual({
      code: 0,
      barcode: 1,
      name: 2,
      category: 3,
      shelf_location: 4,
      cost_price: 5,
      sale_price: 6,
      stock_quantity: 7,
      min_stock_alert: 8,
      unit: 9,
      notes: 10,
    });
  });

  test('İngilizce başlıkları eşleştirir', () => {
    const mapping = detectColumnMapping(['name', 'price', 'shelf', 'stock']);

    expect(mapping).toMatchObject({
      name: 0,
      sale_price: 1,
      shelf_location: 2,
      stock_quantity: 3,
    });
  });

  test('tanınmayan kolonları yok sayar', () => {
    const mapping = detectColumnMapping(['Ürün Adı', 'Tedarikçi', 'Fiyat', 'Raf']);

    expect(mapping.name).toBe(0);
    expect(mapping.sale_price).toBe(2);
    expect(mapping.shelf_location).toBe(3);
    // "Tedarikçi" hiçbir alana atanmamalı.
    expect(Object.values(mapping)).not.toContain(1);
  });

  test('eşleşmeyen alanlar tanımsız kalır', () => {
    const mapping = detectColumnMapping(['Ürün Adı', 'Fiyat', 'Raf']);

    expect(mapping.barcode).toBeUndefined();
    expect(mapping.unit).toBeUndefined();
  });
});

describe('missingRequiredFields', () => {
  test('eksik zorunlu alanları bildirir', () => {
    expect(missingRequiredFields({ name: 0 })).toEqual(['shelf_location', 'sale_price']);
  });

  test('tamam olduğunda boş liste döner', () => {
    expect(missingRequiredFields({ name: 0, shelf_location: 1, sale_price: 2 })).toEqual([]);
  });
});

describe('parseNumericCell', () => {
  test('ondalık virgülü çözer', () => {
    expect(parseNumericCell('24,50')).toBe(24.5);
  });

  test('ondalık noktayı çözer', () => {
    expect(parseNumericCell('24.50')).toBe(24.5);
  });

  test('Türkçe binlik ayırıcıyı çözer', () => {
    // "1.234,50" Türkçe Excel çıktısı.
    expect(parseNumericCell('1.234,50')).toBe(1234.5);
  });

  test('İngilizce binlik ayırıcıyı çözer', () => {
    expect(parseNumericCell('1,234.50')).toBe(1234.5);
  });

  test('para simgesi ve boşlukları temizler', () => {
    expect(parseNumericCell(' 290,00 ₺ ')).toBe(290);
    expect(parseNumericCell('1 250')).toBe(1250);
  });

  test('tam sayıyı çözer', () => {
    expect(parseNumericCell('7')).toBe(7);
    expect(parseNumericCell('0')).toBe(0);
  });

  test('boş hücrede null döner', () => {
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('   ')).toBeNull();
  });

  test('sayı olmayan değerde null döner', () => {
    expect(parseNumericCell('abc')).toBeNull();
    expect(parseNumericCell('12abc')).toBeNull();
  });

  test('negatif değeri korur', () => {
    expect(parseNumericCell('-5')).toBe(-5);
  });
});

describe('parseImportRows', () => {
  /** Başlıklı bir CSV metnini çözüp içe aktarma sonucunu döndürür. */
  function importCsv(text: string) {
    const rows = parseCsv(text);
    const mapping = detectColumnMapping(rows[0] ?? []);

    return { ...parseImportRows(rows, mapping), mapping };
  }

  test('geçerli satırları ürüne çevirir', () => {
    const result = importCsv(
      [
        'Ürün Kodu;Barkod;Ürün Adı;Kategori;Reyon;Alış Fiyatı;Satış Fiyatı;Stok;Kritik Stok;Birim;Notlar',
        'ENV-2001;8690000000012;Klasik Çekiç;El Aletleri;Reyon A - Raf 1;180,00;290,00;14;4;Adet;Ahşap saplı',
      ].join('\n')
    );

    expect(result.errors).toEqual([]);
    expect(result.products).toEqual([
      {
        code: 'ENV-2001',
        barcode: '8690000000012',
        name: 'Klasik Çekiç',
        category: 'El Aletleri',
        shelf_location: 'Reyon A - Raf 1',
        cost_price: 180,
        sale_price: 290,
        stock_quantity: 14,
        min_stock_alert: 4,
        unit: 'Adet',
        notes: 'Ahşap saplı',
      },
    ]);
  });

  test('yalnızca zorunlu alanlarla çalışır', () => {
    const result = importCsv(['Ürün Adı;Reyon;Fiyat', 'İğne;Reyon B;12,75'].join('\n'));

    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({
      name: 'İğne',
      shelf_location: 'Reyon B',
      sale_price: 12.75,
      barcode: null,
      code: undefined,
    });
  });

  test('küçük harfli ürün kodunu büyük harfe çevirir', () => {
    const result = importCsv(['Kod;Ürün Adı;Reyon;Fiyat', 'env-2002;İğne;Reyon B;10'].join('\n'));

    expect(result.products[0]?.code).toBe('ENV-2002');
  });

  test('eksik ürün adını satır numarasıyla bildirir', () => {
    const result = importCsv(['Ürün Adı;Reyon;Fiyat', ';Reyon B;10'].join('\n'));

    expect(result.products).toEqual([]);
    // Başlık 1. satır, ilk veri 2. satır.
    expect(result.errors).toEqual([{ line: 2, messages: ['Ürün adı boş'] }]);
  });

  test('bir satırdaki birden fazla hatayı birlikte bildirir', () => {
    const result = importCsv(['Ürün Adı;Reyon;Fiyat', ';;abc'].join('\n'));

    expect(result.errors[0]?.messages).toHaveLength(3);
    expect(result.errors[0]?.messages.join(' ')).toContain('Ürün adı boş');
    expect(result.errors[0]?.messages.join(' ')).toContain('Reyon veya raf boş');
    expect(result.errors[0]?.messages.join(' ')).toContain('sayı değil');
  });

  test('hatalı satır diğerlerini engellemez', () => {
    // Mağaza dosyasında tek bozuk satır yüzünden hiçbir ürün aktarılmaması
    // kabul edilebilir değil.
    const result = importCsv(
      [
        'Ürün Adı;Reyon;Fiyat',
        'Çekiç;Reyon A;290',
        ';Reyon A;10',
        'İğne;Reyon B;12,75',
      ].join('\n')
    );

    expect(result.products.map((product) => product.name)).toEqual(['Çekiç', 'İğne']);
    expect(result.errors.map((error) => error.line)).toEqual([3]);
  });

  test('negatif fiyatı reddeder', () => {
    const result = importCsv(['Ürün Adı;Reyon;Fiyat', 'Çekiç;Reyon A;-5'].join('\n'));

    expect(result.errors[0]?.messages[0]).toContain('negatif olamaz');
  });

  test('ikiden fazla ondalık basamaklı fiyatı reddeder', () => {
    const result = importCsv(['Ürün Adı;Reyon;Fiyat', 'Çekiç;Reyon A;290,456'].join('\n'));

    expect(result.errors[0]?.messages[0]).toContain('iki ondalık basamak');
  });

  test('ondalıklı stok adedini reddeder', () => {
    const result = importCsv(
      ['Ürün Adı;Reyon;Fiyat;Stok', 'Çekiç;Reyon A;290;3,5'].join('\n')
    );

    expect(result.errors[0]?.messages[0]).toContain('Stok adedi geçersiz');
  });

  test('kontrol hanesi hatalı EAN-13 barkodu reddeder', () => {
    const result = importCsv(
      ['Ürün Adı;Reyon;Fiyat;Barkod', 'Çekiç;Reyon A;290;4006381333932'].join('\n')
    );

    expect(result.errors[0]?.messages[0]).toContain('EAN-13 kontrol hanesi hatalı');
  });

  test('EAN-13 dışındaki barkod biçimlerini kabul eder', () => {
    const result = importCsv(
      ['Ürün Adı;Reyon;Fiyat;Barkod', 'Çekiç;Reyon A;290;96385074'].join('\n')
    );

    expect(result.errors).toEqual([]);
    expect(result.products[0]?.barcode).toBe('96385074');
  });

  test('dosya içinde yinelenen ürün kodunu yakalar', () => {
    // Veritabanına gitmeden yakalanmalı; yoksa ikinci satır birinciyi eziyor.
    const result = importCsv(
      [
        'Kod;Ürün Adı;Reyon;Fiyat',
        'ENV-3001;Çekiç;Reyon A;290',
        'ENV-3001;İğne;Reyon B;12',
      ].join('\n')
    );

    expect(result.products).toHaveLength(1);
    expect(result.errors[0]?.messages[0]).toContain('dosyada birden fazla geçiyor');
  });

  test('dosya içinde yinelenen barkodu yakalar', () => {
    const result = importCsv(
      [
        'Barkod;Ürün Adı;Reyon;Fiyat',
        '8690000000012;Çekiç;Reyon A;290',
        '8690000000012;İğne;Reyon B;12',
      ].join('\n')
    );

    expect(result.products).toHaveLength(1);
    expect(result.errors[0]?.messages[0]).toContain('Barkod dosyada birden fazla geçiyor');
  });

  test('aynı kod büyük/küçük harfle yazılsa da yinelenme sayılır', () => {
    const result = importCsv(
      [
        'Kod;Ürün Adı;Reyon;Fiyat',
        'env-3002;Çekiç;Reyon A;290',
        'ENV-3002;İğne;Reyon B;12',
      ].join('\n')
    );

    expect(result.errors).toHaveLength(1);
  });

  test('eksik kolonlu satırı boş değer gibi ele alır', () => {
    const result = importCsv(['Ürün Adı;Reyon;Fiyat', 'Çekiç;Reyon A'].join('\n'));

    expect(result.errors[0]?.messages[0]).toBe('Satış fiyatı boş');
  });

  test('yalnızca başlık satırı olan dosyada sonuç boş', () => {
    const result = importCsv('Ürün Adı;Reyon;Fiyat');

    expect(result.products).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('tırnaklı ve virgüllü alanları doğru çözer', () => {
    const result = importCsv(
      ['Ürün Adı;Reyon;Fiyat;Notlar', '"Çekiç, büyük";Reyon A;1.290,50;"Ağır, sağlam"'].join('\n')
    );

    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({
      name: 'Çekiç, büyük',
      sale_price: 1290.5,
      notes: 'Ağır, sağlam',
    });
  });

  test('sıfır fiyat ve sıfır stok geçerli', () => {
    const result = importCsv(
      ['Ürün Adı;Reyon;Fiyat;Stok', 'Promosyon Ürünü;Reyon A;0;0'].join('\n')
    );

    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({ sale_price: 0, stock_quantity: 0 });
  });
});
