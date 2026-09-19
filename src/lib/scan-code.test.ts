import { describe, expect, test } from 'vitest';
import {
  buildScanUrl,
  ean13CheckDigit,
  isValidEan13,
  nextProductCode,
  normalizeScan,
  PRODUCT_CODE_START,
} from './scan-code';

describe('ean13CheckDigit', () => {
  test('bilinen barkodların kontrol hanesini hesaplar', () => {
    // Gerçek hayattan doğrulanmış EAN-13 örnekleri
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931
    expect(ean13CheckDigit('590123412345')).toBe(7); // 5901234123457
    expect(ean13CheckDigit('001234567890')).toBe(5); // 0012345678905
  });

  test('ağırlıklı toplam 10un katı olduğunda kontrol hanesi 0 olur', () => {
    // Bu sınır durumda (10 - 0) % 10 ifadesinin 10 değil 0 vermesi gerekir
    expect(ean13CheckDigit('000000000000')).toBe(0);
  });

  test('12 haneden farklı girdiyi reddeder', () => {
    expect(() => ean13CheckDigit('40063813339')).toThrow();
    expect(() => ean13CheckDigit('4006381333931')).toThrow();
    expect(() => ean13CheckDigit('')).toThrow();
  });

  test('rakam dışı karakter içeren girdiyi reddeder', () => {
    expect(() => ean13CheckDigit('40063813339X')).toThrow();
  });
});

describe('isValidEan13', () => {
  test('geçerli barkodları kabul eder', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('5901234123457')).toBe(true);
    expect(isValidEan13('0012345678905')).toBe(true);
  });

  test('kontrol hanesi hatalı barkodu reddeder', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('5901234123450')).toBe(false);
  });

  test('13 haneden farklı uzunlukları reddeder', () => {
    expect(isValidEan13('400638133393')).toBe(false);
    expect(isValidEan13('40063813339311')).toBe(false);
  });

  test('rakam dışı karakter ve boş değeri reddeder', () => {
    expect(isValidEan13('400638133393A')).toBe(false);
    expect(isValidEan13('')).toBe(false);
    expect(isValidEan13('   ')).toBe(false);
  });
});

describe('normalizeScan - ürün karekodu (ENV kodu)', () => {
  test('ENV kodunu tanır', () => {
    const result = normalizeScan('ENV-1001');

    expect(result.kind).toBe('qr');
    expect(result.code).toBe('ENV-1001');
  });

  test('küçük harfli kodu büyük harfe çevirir', () => {
    expect(normalizeScan('env-1001').code).toBe('ENV-1001');
  });

  test('baştaki ve sondaki boşluk ile satır sonunu kırpar', () => {
    // Bazı barkod okuyucular değerin sonuna satır sonu ekler
    const result = normalizeScan('  env-1001\r\n');

    expect(result.kind).toBe('qr');
    expect(result.code).toBe('ENV-1001');
  });
});

describe('normalizeScan - URL yükü', () => {
  test('etiketteki adresten kodu ayıklar', () => {
    const result = normalizeScan('https://reyonstok.vercel.app/scan?code=ENV-1042');

    expect(result.kind).toBe('qr');
    expect(result.code).toBe('ENV-1042');
  });

  test('yerel adres ve küçük harfli kodla da çalışır', () => {
    expect(normalizeScan('http://localhost:3000/scan?code=env-7').code).toBe('ENV-7');
  });

  test('URL içindeki barkodu EAN-13 olarak sınıflandırır', () => {
    const result = normalizeScan('https://reyonstok.vercel.app/scan?code=4006381333931');

    expect(result.kind).toBe('ean13');
    expect(result.code).toBe('4006381333931');
  });

  test('code parametresi olmayan adres kullanılabilir değer vermez', () => {
    const result = normalizeScan('https://reyonstok.vercel.app/scan');

    expect(result.code).toBe('');
    expect(result.kind).toBe('unknown');
  });

  test('bozuk adresi düz metin gibi değerlendirir', () => {
    const result = normalizeScan('https://[bozuk');

    expect(result.kind).toBe('unknown');
    expect(result.code).toBe('https://[bozuk');
  });
});

describe('normalizeScan - barkodlar', () => {
  test('geçerli EAN-13 barkodunu tanır', () => {
    const result = normalizeScan('4006381333931');

    expect(result.kind).toBe('ean13');
    expect(result.code).toBe('4006381333931');
  });

  test('kontrol hanesi hatalı 13 haneyi doğrulanmamış sayar ama değeri korur', () => {
    // Elle yazılmış hatalı barkod: aramayı yine deneyebilmek için kod korunur,
    // ancak EAN-13 olarak doğrulanmadığı belirtilir.
    const result = normalizeScan('4006381333932');

    expect(result.kind).toBe('unknown');
    expect(result.code).toBe('4006381333932');
  });

  test('EAN-8 gibi diğer barkodları aranabilir değer olarak döndürür', () => {
    const result = normalizeScan('96385074');

    expect(result.kind).toBe('unknown');
    expect(result.code).toBe('96385074');
  });

  test('Code-128 alfanumerik değerde harf büyüklüğünü bozmaz', () => {
    const result = normalizeScan('  aBc-123-xYz ');

    expect(result.kind).toBe('unknown');
    expect(result.code).toBe('aBc-123-xYz');
  });
});

describe('normalizeScan - kullanılamayan girdiler', () => {
  test('boş ve yalnızca boşluktan oluşan değer kod üretmez', () => {
    expect(normalizeScan('').code).toBe('');
    expect(normalizeScan('    ').code).toBe('');
  });

  test('null ve undefined ile çökmez', () => {
    expect(normalizeScan(null).code).toBe('');
    expect(normalizeScan(undefined).code).toBe('');
  });

  test('ham değeri olduğu gibi taşır', () => {
    expect(normalizeScan('  env-1001\n').raw).toBe('  env-1001\n');
  });
});

describe('nextProductCode', () => {
  test('hiç ürün yokken başlangıç kodunu verir', () => {
    expect(nextProductCode()).toBe(PRODUCT_CODE_START);
    expect(nextProductCode(null)).toBe(PRODUCT_CODE_START);
    expect(nextProductCode('')).toBe(PRODUCT_CODE_START);
  });

  test('son kodu bir artırır', () => {
    expect(nextProductCode('ENV-1001')).toBe('ENV-1002');
  });

  test('küçük harfli son kodu büyük harfe çevirerek artırır', () => {
    expect(nextProductCode('env-1001')).toBe('ENV-1002');
  });

  test('hane sayısı büyüdüğünde taşmayı doğru yapar', () => {
    expect(nextProductCode('ENV-9999')).toBe('ENV-10000');
  });

  test('sıfır dolgusunu korur', () => {
    expect(nextProductCode('ENV-0007')).toBe('ENV-0008');
    expect(nextProductCode('ENV-0099')).toBe('ENV-0100');
  });

  test('tanınmayan biçimde başlangıç koduna döner', () => {
    expect(nextProductCode('BOZUK-KOD')).toBe(PRODUCT_CODE_START);
  });
});

describe('buildScanUrl', () => {
  test('etiket için tarama adresi üretir', () => {
    expect(buildScanUrl('ENV-1001', 'https://reyonstok.vercel.app')).toBe(
      'https://reyonstok.vercel.app/scan?code=ENV-1001'
    );
  });

  test('adresin sonundaki eğik çizgiyi tekrarlamaz', () => {
    expect(buildScanUrl('ENV-1001', 'https://reyonstok.vercel.app/')).toBe(
      'https://reyonstok.vercel.app/scan?code=ENV-1001'
    );
  });

  test('üretilen adres okunduğunda aynı koda dönüşür', () => {
    // Etiket basımı ile tarama arasındaki turun kapandığını doğrular
    const url = buildScanUrl('ENV-1042', 'https://reyonstok.vercel.app');

    expect(normalizeScan(url).code).toBe('ENV-1042');
    expect(normalizeScan(url).kind).toBe('qr');
  });

  test('özel karakter içeren kodu adres için kaçışlar', () => {
    const url = buildScanUrl('ENV 10/1', 'https://reyonstok.vercel.app');

    expect(url).toBe('https://reyonstok.vercel.app/scan?code=ENV%2010%2F1');
    expect(normalizeScan(url).code).toBe('ENV 10/1');
  });
});
