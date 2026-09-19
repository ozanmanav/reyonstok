/**
 * CSV okuma ve yazma.
 *
 * Neden hazır paket yerine kendi çözümleyicimiz: mağazadan gelecek dosyaların
 * kaynağı Excel ve Türkçe yerel ayar. Bunun getirdiği üç özel durumu açıkça
 * ele almamız gerekiyor:
 *
 *  - Ayırıcı genellikle noktalı virgül. Türkçe Windows'ta Excel "CSV olarak
 *    kaydet" dediğinde virgül değil `;` kullanır, çünkü virgül ondalık ayırıcı.
 *  - Dosya başına BOM eklenir. Temizlenmezse ilk kolon adı görünmez bir
 *    karakterle başlar ve kolon eşleştirmesi tutmaz.
 *  - Satır sonları CRLF olur.
 *
 * Dışa aktarmada da aynısı geçerli: BOM olmadan Excel dosyayı Windows-1254
 * sanıp Türkçe karakterleri bozuyor.
 */

/** Excel'in UTF-8 dosyaları tanıması için dosya başına eklenen işaret. */
const BOM = '\uFEFF';

/** Tanınan ayırıcılar. Sıra, eşitlik durumundaki tercihi belirler. */
const CANDIDATE_DELIMITERS = [';', ',', '\t'] as const;

export type CsvDelimiter = (typeof CANDIDATE_DELIMITERS)[number];

/**
 * İlk satıra bakarak ayırıcıyı tahmin eder.
 *
 * Tırnak içindeki ayırıcılar sayılmaz; "Çekiç, büyük";12 satırında virgül
 * sayılırsa ayırıcı yanlış seçilirdi.
 *
 * Hiçbir ayırıcı bulunmazsa (tek kolonlu dosya) noktalı virgül varsayılır.
 */
export function detectDelimiter(firstLine: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>();

  for (const delimiter of CANDIDATE_DELIMITERS) {
    counts.set(delimiter, 0);
  }

  let inQuotes = false;

  for (let index = 0; index < firstLine.length; index += 1) {
    const char = firstLine[index];

    if (char === '"') {
      // Çift tırnak kaçışı: "" tek tırnak demek, alıntı durumu değişmez.
      if (inQuotes && firstLine[index + 1] === '"') {
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (inQuotes) {
      continue;
    }

    const known = CANDIDATE_DELIMITERS.find((candidate) => candidate === char);
    if (known) {
      counts.set(known, (counts.get(known) ?? 0) + 1);
    }
  }

  let best: CsvDelimiter = ';';
  let bestCount = 0;

  // CANDIDATE_DELIMITERS sırası gezildiği ve yalnızca kesin fazlada güncellendiği
  // için eşitlikte listedeki ilk aday (noktalı virgül) kazanır.
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const count = counts.get(delimiter) ?? 0;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

/**
 * CSV metnini satır ve hücrelere ayırır.
 *
 * RFC 4180 davranışı: tırnaklı hücreler ayırıcı ve satır sonu içerebilir,
 * tırnak içinde `""` tek tırnak anlamına gelir.
 *
 * @param text Dosya içeriği.
 * @param delimiter Verilmezse ilk satırdan tahmin edilir.
 */
export function parseCsv(text: string, delimiter?: CsvDelimiter): string[][] {
  const content = text.startsWith(BOM) ? text.slice(BOM.length) : text;

  if (content.trim() === '') {
    return [];
  }

  const firstLineEnd = content.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
  const activeDelimiter = delimiter ?? detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };

  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          cell += '"';
          index += 1;
          continue;
        }

        inQuotes = false;
        continue;
      }

      cell += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === activeDelimiter) {
      endCell();
      continue;
    }

    if (char === '\n') {
      endRow();
      continue;
    }

    // CRLF'in \r'sini yok say; hücre sonuna görünmez karakter eklenmesin.
    if (char === '\r') {
      continue;
    }

    cell += char;
  }

  // Dosya satır sonu ile bitmiyorsa son satır henüz kapatılmadı.
  if (cell !== '' || row.length > 0) {
    endRow();
  }

  // Tamamen boş satırları at: Excel dosya sonuna boş satır ekliyor.
  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ''));
}

/**
 * Satırları CSV metnine çevirir.
 *
 * Varsayılanlar Excel'in Türkçe yerel ayarına göre seçildi: noktalı virgül
 * ayırıcı, CRLF satır sonu ve dosya başında BOM.
 */
export function toCsv(
  rows: (string | number | null | undefined)[][],
  options: { delimiter?: CsvDelimiter; withBom?: boolean } = {}
): string {
  const delimiter = options.delimiter ?? ';';
  const withBom = options.withBom ?? true;

  const body = rows
    .map((row) => row.map((value) => escapeCsvValue(value, delimiter)).join(delimiter))
    .join('\r\n');

  return `${withBom ? BOM : ''}${body}`;
}

/** Gerekliyse hücreyi tırnaklar ve içindeki tırnakları ikiler. */
function escapeCsvValue(
  value: string | number | null | undefined,
  delimiter: CsvDelimiter
): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);

  const needsQuotes =
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r');

  if (!needsQuotes) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}
