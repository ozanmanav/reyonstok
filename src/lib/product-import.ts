import { isValidEan13 } from './scan-code';

/**
 * CSV satırlarının ürün kayıtlarına çevrilmesi.
 *
 * Mağazadan gelen dosyanın kolon adları belli değil: Türkçe, İngilizce, büyük
 * harf, boşluklu... Bu yüzden kolonlar takma adlarla eşleştiriliyor ve sonuç
 * kullanıcıya önizleme olarak gösteriliyor, böylece yanlış eşleşme kör bir
 * içe aktarmaya dönüşmüyor.
 *
 * Hatalı satırlar işlemi durdurmuyor: geçerli satırlar aktarılıp hatalı olanlar
 * satır numarasıyla raporlanıyor. Mağaza dosyalarında tek bozuk satır yüzünden
 * 500 ürünün aktarılamaması kabul edilebilir değil.
 */

/** İçe aktarılabilen alanlar. */
export type ImportField =
  | 'code'
  | 'barcode'
  | 'name'
  | 'category'
  | 'shelf_location'
  | 'cost_price'
  | 'sale_price'
  | 'stock_quantity'
  | 'min_stock_alert'
  | 'unit'
  | 'notes';

/** Kolon başlığı -> alan eşleştirmesi için tanınan adlar. */
const FIELD_ALIASES: Record<ImportField, string[]> = {
  code: ['kod', 'urun kodu', 'ürün kodu', 'stok kodu', 'code', 'product code', 'sku'],
  barcode: ['barkod', 'barcode', 'ean', 'ean13', 'ean-13', 'gtin'],
  name: ['ad', 'adi', 'adı', 'urun adi', 'ürün adı', 'urun', 'ürün', 'name', 'product name'],
  category: ['kategori', 'grup', 'category', 'group'],
  shelf_location: [
    'reyon',
    'raf',
    'reyon raf',
    'reyon/raf',
    'konum',
    'yer',
    'shelf',
    'location',
    'shelf location',
  ],
  cost_price: ['alis fiyati', 'alış fiyatı', 'alis', 'alış', 'maliyet', 'cost', 'cost price'],
  sale_price: [
    'satis fiyati',
    'satış fiyatı',
    'fiyat',
    'satis',
    'satış',
    'price',
    'sale price',
  ],
  stock_quantity: ['stok', 'stok adedi', 'adet', 'miktar', 'stock', 'quantity', 'stock quantity'],
  min_stock_alert: [
    'kritik stok',
    'kritik stok esigi',
    'kritik stok eşiği',
    'min stok',
    'minimum stok',
    'min stock',
    'min stock alert',
  ],
  unit: ['birim', 'unit'],
  notes: ['not', 'notlar', 'aciklama', 'açıklama', 'notes', 'description'],
};

/** Zorunlu alanlar: bunlar eşleşmezse içe aktarma başlatılamaz. */
export const REQUIRED_FIELDS: ImportField[] = ['name', 'shelf_location', 'sale_price'];

/** Alanların arayüzde gösterilen adları. */
export const FIELD_LABELS: Record<ImportField, string> = {
  code: 'Ürün kodu',
  barcode: 'Barkod',
  name: 'Ürün adı',
  category: 'Kategori',
  shelf_location: 'Reyon / raf',
  cost_price: 'Alış fiyatı',
  sale_price: 'Satış fiyatı',
  stock_quantity: 'Stok adedi',
  min_stock_alert: 'Kritik stok eşiği',
  unit: 'Birim',
  notes: 'Notlar',
};

/** Alan -> kolon indeksi. Eşleşmeyen alan için null. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

/**
 * Başlık metnini karşılaştırmaya uygun hale getirir.
 *
 * Türkçe karakterler ve noktalama dosyadan dosyaya değişiyor; "Ürün Adı",
 * "URUN_ADI" ve "urun adi" aynı kolonu göstermeli.
 */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('İ', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Başlık satırından alan eşleştirmesini çıkarır. */
export function detectColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((header) => normalizeHeader(header));
  const mapping: ColumnMapping = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [ImportField, string[]][]) {
    const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));
    const index = normalized.findIndex((header) => normalizedAliases.includes(header));

    if (index !== -1) {
      mapping[field] = index;
    }
  }

  return mapping;
}

/** İçe aktarma için hazır tek ürün kaydı. */
export interface ImportedProduct {
  code?: string;
  barcode: string | null;
  name: string;
  category?: string;
  shelf_location: string;
  cost_price?: number;
  sale_price: number;
  stock_quantity?: number;
  min_stock_alert?: number;
  unit?: string;
  notes?: string;
}

export interface RowError {
  /** Dosyadaki satır numarası (başlık 1 sayılır). */
  line: number;
  messages: string[];
}

export interface ParsedImport {
  products: ImportedProduct[];
  errors: RowError[];
}

/**
 * Sayısal alanı çözer.
 *
 * Türkçe Excel çıktısında binlik ayırıcı nokta, ondalık ayırıcı virgül olur
 * ("1.234,50"). Ayrıca para simgesi ve boşluk kalabilir.
 */
export function parseNumericCell(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/\s/g, '')
    .replace(/[₺$€]/g, '');

  if (cleaned === '') {
    return null;
  }

  // Hem nokta hem virgül varsa: son görülen ondalık ayırıcıdır.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized = cleaned;

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      normalized = cleaned.replaceAll('.', '').replace(',', '.');
    } else {
      normalized = cleaned.replaceAll(',', '');
    }
  } else if (lastComma !== -1) {
    // Yalnızca virgül var: ondalık ayırıcı kabul ediliyor ("24,50").
    normalized = cleaned.replace(',', '.');
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

/** İki ondalık basamağı aşan tutarları yakalar (numeric(12,2) sessizce yuvarlar). */
function hasTooManyDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) > 1e-9;
}

/**
 * Veri satırlarını doğrulayıp ürün kayıtlarına çevirir.
 *
 * @param rows Başlık satırı dahil tüm satırlar.
 * @param mapping Alan -> kolon eşleştirmesi.
 */
export function parseImportRows(rows: string[][], mapping: ColumnMapping): ParsedImport {
  const products: ImportedProduct[] = [];
  const errors: RowError[] = [];
  const seenCodes = new Set<string>();
  const seenBarcodes = new Set<string>();

  // İlk satır başlık; veri ikinci satırdan başlıyor.
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const line = index + 1;
    const messages: string[] = [];

    const read = (field: ImportField): string => {
      const column = mapping[field];

      if (column === undefined) {
        return '';
      }

      return (row[column] ?? '').trim();
    };

    const name = read('name');
    const shelf = read('shelf_location');
    const salePriceRaw = read('sale_price');

    if (name === '') {
      messages.push('Ürün adı boş');
    }

    if (shelf === '') {
      messages.push('Reyon veya raf boş');
    }

    const salePrice = parseNumericCell(salePriceRaw);
    if (salePriceRaw === '') {
      messages.push('Satış fiyatı boş');
    } else if (salePrice === null) {
      messages.push(`Satış fiyatı sayı değil: "${salePriceRaw}"`);
    } else if (salePrice < 0) {
      messages.push('Satış fiyatı negatif olamaz');
    } else if (hasTooManyDecimals(salePrice)) {
      messages.push('Satış fiyatı en fazla iki ondalık basamak içerebilir');
    }

    const costPriceRaw = read('cost_price');
    const costPrice = parseNumericCell(costPriceRaw);
    if (costPriceRaw !== '' && (costPrice === null || costPrice < 0)) {
      messages.push(`Alış fiyatı geçersiz: "${costPriceRaw}"`);
    } else if (costPrice !== null && hasTooManyDecimals(costPrice)) {
      messages.push('Alış fiyatı en fazla iki ondalık basamak içerebilir');
    }

    const stockRaw = read('stock_quantity');
    const stock = parseNumericCell(stockRaw);
    if (stockRaw !== '' && (stock === null || !Number.isInteger(stock) || stock < 0)) {
      messages.push(`Stok adedi geçersiz: "${stockRaw}"`);
    }

    const minStockRaw = read('min_stock_alert');
    const minStock = parseNumericCell(minStockRaw);
    if (minStockRaw !== '' && (minStock === null || !Number.isInteger(minStock) || minStock < 0)) {
      messages.push(`Kritik stok eşiği geçersiz: "${minStockRaw}"`);
    }

    const barcode = read('barcode');
    if (/^\d{13}$/.test(barcode) && !isValidEan13(barcode)) {
      messages.push(`EAN-13 kontrol hanesi hatalı: ${barcode}`);
    }

    const code = read('code').toUpperCase();

    // Dosya içi yinelenmeler: veritabanına gitmeden yakalanmalı, yoksa aynı
    // içe aktarmada ikinci satır birinciyi sessizce eziyor.
    if (code !== '') {
      if (seenCodes.has(code)) {
        messages.push(`Ürün kodu dosyada birden fazla geçiyor: ${code}`);
      } else {
        seenCodes.add(code);
      }
    }

    if (barcode !== '') {
      if (seenBarcodes.has(barcode)) {
        messages.push(`Barkod dosyada birden fazla geçiyor: ${barcode}`);
      } else {
        seenBarcodes.add(barcode);
      }
    }

    if (messages.length > 0) {
      errors.push({ line, messages });
      continue;
    }

    products.push({
      code: code === '' ? undefined : code,
      barcode: barcode === '' ? null : barcode,
      name,
      category: read('category') || undefined,
      shelf_location: shelf,
      cost_price: costPrice ?? undefined,
      // salePrice null olamaz: yukarıdaki kontroller geçtiyse sayıdır.
      sale_price: salePrice as number,
      stock_quantity: stock ?? undefined,
      min_stock_alert: minStock ?? undefined,
      unit: read('unit') || undefined,
      notes: read('notes') || undefined,
    });
  }

  return { products, errors };
}

/** Eşleştirmede eksik olan zorunlu alanları döndürür. */
export function missingRequiredFields(mapping: ColumnMapping): ImportField[] {
  return REQUIRED_FIELDS.filter((field) => mapping[field] === undefined);
}
