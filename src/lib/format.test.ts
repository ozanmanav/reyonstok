import { describe, expect, test } from 'vitest';
import {
  formatChange,
  formatCurrency,
  formatCurrencyCompact,
  formatDateTime,
  formatPrice,
  formatQuantity,
  formatShortDate,
  formatTime,
} from './format';

describe('para biçimlendirme', () => {
  test('kuruşları virgülle iki basamak gösterir', () => {
    expect(formatPrice(290)).toBe('290,00');
    expect(formatPrice(24.5)).toBe('24,50');
    expect(formatPrice(0)).toBe('0,00');
  });

  test('binlik ayırıcı nokta kullanır', () => {
    expect(formatPrice(1234.56)).toBe('1.234,56');
  });

  test('simgeli gösterim para birimini ekler', () => {
    expect(formatCurrency(290)).toBe('290,00 ₺');
  });

  test('toplamlarda kuruş gösterilmez', () => {
    expect(formatCurrencyCompact(12950)).toBe('12.950 ₺');
    expect(formatCurrencyCompact(12950.49)).toBe('12.950 ₺');
  });
});

describe('adet biçimlendirme', () => {
  test('binlik ayırıcı ekler', () => {
    expect(formatQuantity(1250)).toBe('1.250');
    expect(formatQuantity(7)).toBe('7');
  });
});

describe('tarih biçimlendirme', () => {
  // Saat dilimi sabitlendiği için bu testler makinenin saat diliminden bağımsız.
  const instant = '2026-09-18T18:12:00.000Z';

  test('tarih ve saati Türkiye saatine çevirir', () => {
    // UTC 18:12, Türkiye saatiyle 21:12.
    expect(formatDateTime(instant)).toBe('18.09.2026 21:12');
  });

  test('yalnızca saat gösterimi', () => {
    expect(formatTime(instant)).toBe('21:12');
  });

  test('kısa tarih gösterimi', () => {
    expect(formatShortDate(instant)).toBe('18.09.26');
  });

  test('gün sınırını doğru aşar', () => {
    // UTC 22:30, Türkiye saatiyle ertesi gün 01:30.
    expect(formatDateTime('2026-09-18T22:30:00.000Z')).toBe('19.09.2026 01:30');
  });
});

describe('değişim biçimlendirme', () => {
  test('artışta artı işareti ekler', () => {
    expect(formatChange(3)).toBe('+3');
  });

  test('azalışta eksi işareti korunur', () => {
    expect(formatChange(-1)).toBe('-1');
  });

  test('değişim yoksa sıfır gösterir', () => {
    expect(formatChange(0)).toBe('0');
  });
});
