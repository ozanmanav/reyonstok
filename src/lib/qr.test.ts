// @vitest-environment node

import QRCode from 'qrcode';
import { describe, expect, test } from 'vitest';
import { buildLabelPayload } from './label';
import { QR_ENCODE_OPTIONS, renderQrSvg, renderQrSvgMap } from './qr';

/**
 * Karekod SVG üretimi.
 *
 * Kodlama, hata düzeltme ve maskeleme işini `qrcode` paketi yapıyor; burada
 * bizim seçimlerimizi doğruluyoruz: çıktının ölçeklenebilir olması, sessiz
 * bölgenin eklenmesi, metnin SVG'ye metin olarak sızmaması ve aynı girdide aynı
 * çıktının üretilmesi.
 *
 * Basılan karekodun gerçekten okunabildiği ayrıca tests/scanner-wasm.test.ts
 * içinde, gerçek çözümleyiciyle doğrulanıyor.
 */

const SAMPLE_PAYLOAD = buildLabelPayload('ENV-1001', 'https://reyonstok.vercel.app');

describe('renderQrSvg', () => {
  test('ölçeklenebilir SVG üretir', async () => {
    const svg = await renderQrSvg(SAMPLE_PAYLOAD);

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox=');
    // Sabit boyut verilmemeli: etiket düzeni ölçüyü CSS ile belirliyor, aksi
    // halde A4 ve termal etikette aynı karekod kullanılamazdı.
    expect(svg).not.toContain('width=');
    expect(svg).not.toContain('height=');
  });

  test('viewBox modül sayısına iki modüllük sessiz bölge ekler', async () => {
    const svg = await renderQrSvg(SAMPLE_PAYLOAD);
    const modules = QRCode.create(SAMPLE_PAYLOAD, QR_ENCODE_OPTIONS).modules.size;

    // Sessiz bölge olmadan çözümleyiciler karekodun kenarını bulamıyor.
    const expected = modules + 2 * QR_ENCODE_OPTIONS.margin;
    expect(svg).toContain(`viewBox="0 0 ${expected} ${expected}"`);
  });

  test('taşınan metin SVG içine metin olarak yazılmaz', async () => {
    // Etiket adresi ortam değişkeninden geliyor. Değer SVG'ye metin olarak
    // girmiş olsaydı, sayfaya `dangerouslySetInnerHTML` ile gömüldüğü için
    // işaretleme kaçışı mümkün olurdu.
    const svg = await renderQrSvg('https://magaza.com/scan?code="/><script>x</script>');

    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('magaza.com');
    // Çıktı yalnızca yol verisinden oluşmalı.
    expect(svg).not.toContain('<text');
  });

  test('aynı girdi aynı çıktıyı verir', async () => {
    // Belirli olmayan bir çıktı, baskıyı yenilediğinde farklı karekod üretip
    // eski etiketlerle karşılaştırmayı imkansız kılardı.
    const [first, second] = await Promise.all([
      renderQrSvg(SAMPLE_PAYLOAD),
      renderQrSvg(SAMPLE_PAYLOAD),
    ]);

    expect(first).toBe(second);
  });

  test('farklı ürün kodları farklı karekod üretir', async () => {
    const [first, second] = await Promise.all([
      renderQrSvg(buildLabelPayload('ENV-1001', 'https://reyonstok.vercel.app')),
      renderQrSvg(buildLabelPayload('ENV-1002', 'https://reyonstok.vercel.app')),
    ]);

    expect(first).not.toBe(second);
  });

  test('düz ürün kodu da kodlanabilir', async () => {
    // Genel adres tanımlı olmadığında etikete yalnızca kod basılıyor.
    const svg = await renderQrSvg('ENV-1001');

    expect(svg).toContain('viewBox="0 0 25 25"');
  });
});

describe('renderQrSvgMap', () => {
  test('her metin için karekod döndürür', async () => {
    const map = await renderQrSvgMap(['ENV-1001', 'ENV-1002']);

    expect(Object.keys(map)).toEqual(['ENV-1001', 'ENV-1002']);
    expect(map['ENV-1001']).not.toBe(map['ENV-1002']);
  });

  test('yinelenen metinler tek kez üretilir', async () => {
    const map = await renderQrSvgMap(['ENV-1001', 'ENV-1001']);

    expect(Object.keys(map)).toEqual(['ENV-1001']);
  });

  test('boş liste boş eşleme döndürür', async () => {
    expect(await renderQrSvgMap([])).toEqual({});
  });
});
