import { describe, expect, test } from 'vitest';
import { detectDelimiter, parseCsv, toCsv } from './csv';

const BOM = '\uFEFF';

describe('detectDelimiter', () => {
  test('noktalı virgülü seçer', () => {
    // Türkçe Windows'ta Excel'in varsayılan çıktısı.
    expect(detectDelimiter('Ürün Adı;Fiyat;Stok')).toBe(';');
  });

  test('virgülü seçer', () => {
    expect(detectDelimiter('name,price,stock')).toBe(',');
  });

  test('sekmeyi seçer', () => {
    expect(detectDelimiter('name\tprice\tstock')).toBe('\t');
  });

  test('tırnak içindeki ayırıcıları saymaz', () => {
    // Virgül tırnak içinde kaldığı için ayırıcı noktalı virgül olmalı.
    expect(detectDelimiter('"Çekiç, büyük";290')).toBe(';');
  });

  test('tek kolonlu dosyada noktalı virgüle düşer', () => {
    expect(detectDelimiter('Ürün Adı')).toBe(';');
  });

  test('eşitlikte noktalı virgülü tercih eder', () => {
    expect(detectDelimiter('a,b;c')).toBe(';');
  });
});

describe('parseCsv', () => {
  test('basit satırları ayırır', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('CRLF satır sonlarını temizler', () => {
    // \r hücrede kalırsa kolon adları eşleşmiyor.
    expect(parseCsv('a;b\r\n1;2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('dosya başındaki BOM işaretini atar', () => {
    const rows = parseCsv(`${BOM}Ürün Adı;Fiyat\nÇekiç;290`);

    expect(rows[0]?.[0]).toBe('Ürün Adı');
  });

  test('tırnaklı hücre içindeki ayırıcıyı korur', () => {
    expect(parseCsv('ad;not\n"Çekiç";"Büyük, ağır"')).toEqual([
      ['ad', 'not'],
      ['Çekiç', 'Büyük, ağır'],
    ]);
  });

  test('tırnaklı hücre içindeki satır sonunu korur', () => {
    const rows = parseCsv('ad;not\n"Çekiç";"birinci satır\nikinci satır"');

    expect(rows).toHaveLength(2);
    expect(rows[1]?.[1]).toBe('birinci satır\nikinci satır');
  });

  test('ikili tırnağı tek tırnağa çevirir', () => {
    expect(parseCsv('ad\n"12"" boru"')).toEqual([['ad'], ['12" boru']]);
  });

  test('boş hücreleri korur', () => {
    expect(parseCsv('a;b;c\n1;;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  test('tamamen boş satırları atar', () => {
    // Excel dosya sonuna boş satır ekliyor.
    expect(parseCsv('a;b\n1;2\n\n;\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('boş dosyada boş liste döner', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('   \n  ')).toEqual([]);
    expect(parseCsv(BOM)).toEqual([]);
  });

  test('Türkçe karakterleri bozmaz', () => {
    const rows = parseCsv('ad;reyon\nİğne Ucu;Şişli Reyonu ÇĞÖÜ');

    expect(rows[1]).toEqual(['İğne Ucu', 'Şişli Reyonu ÇĞÖÜ']);
  });

  test('ondalık virgüllü sayıları metin olarak taşır', () => {
    // Dönüştürme bu katmanın işi değil; ayırıcı noktalı virgül olduğu için
    // "24,50" tek hücre olarak gelmeli.
    expect(parseCsv('fiyat;stok\n24,50;7')).toEqual([
      ['fiyat', 'stok'],
      ['24,50', '7'],
    ]);
  });

  test('verilen ayırıcıyı tahmine tercih eder', () => {
    expect(parseCsv('a,b;c', ',')).toEqual([['a', 'b;c']]);
  });

  test('son satır satır sonu ile bitmese de okunur', () => {
    expect(parseCsv('a;b\n1;2')).toHaveLength(2);
  });

  test('satırlar farklı uzunlukta olabilir', () => {
    // Eksik kolonlar doğrulama katmanında raporlanacak.
    expect(parseCsv('a;b;c\n1;2')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2'],
    ]);
  });
});

describe('toCsv', () => {
  test('noktalı virgül, CRLF ve BOM ile yazar', () => {
    const output = toCsv([
      ['ad', 'fiyat'],
      ['Çekiç', '290,00'],
    ]);

    expect(output.startsWith(BOM)).toBe(true);
    expect(output).toBe(`${BOM}ad;fiyat\r\nÇekiç;290,00`);
  });

  test('ayırıcı içeren değeri tırnaklar', () => {
    expect(toCsv([['Büyük; ağır']], { withBom: false })).toBe('"Büyük; ağır"');
  });

  test('tırnak içeren değeri ikileyerek kaçışlar', () => {
    expect(toCsv([['12" boru']], { withBom: false })).toBe('"12"" boru"');
  });

  test('satır sonu içeren değeri tırnaklar', () => {
    expect(toCsv([['birinci\nikinci']], { withBom: false })).toBe('"birinci\nikinci"');
  });

  test('null ve undefined boş hücreye dönüşür', () => {
    expect(toCsv([['a', null, undefined, 'b']], { withBom: false })).toBe('a;;;b');
  });

  test('sayıları metne çevirir', () => {
    expect(toCsv([[1, 24.5]], { withBom: false })).toBe('1;24.5');
  });

  test('yazılan dosya geri okunduğunda aynı veriyi verir', () => {
    const rows = [
      ['ad', 'not', 'fiyat'],
      ['Çekiç', 'Büyük, ağır ve "sağlam"', '290,00'],
      ['İğne', 'birinci satır\nikinci satır', '12,75'],
    ];

    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
