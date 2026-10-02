export type ItemTypeCode = 'CNU' | 'SPT' | 'PS' | 'LIB' | 'LUB';

export type StockRemark = 'ORDER' | 'AMAN' | 'OVER';

export type MovementCategory = 'Fast Moving' | 'Slow Moving' | 'Dead Moving';

export type TransactionType = 'IN' | 'OUT' | 'ADJ_PLUS' | 'ADJ_MINUS';

export interface InventoryItem {
  id: string; // Matches codeItem e.g. "DPS-2105"
  no: number;
  codeItem: string;
  rak: string;
  typeCode: ItemTypeCode;
  modelUnit: string;
  partNumber: string;
  partName: string;
  codeUnit: string;
  tanggalUpdate: string;
  tanggalMasuk: string;
  tanggalKeluar: string;
  supplier: string;
  brand: string;
  awalQty: number;
  unit: string;
  inQty: number;
  adjPlusQty: number;
  outQty: number;
  adjMinusQty: number;
  akhirQty: number;
  minQty: number;
  maxQty: number;
  remark: StockRemark;
  movementStatus: MovementCategory;
  price: number;
  totalValue: number;
  priceNote: string;
  status1th: string;
  orgId: string;
  updatedByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WarehouseTransaction {
  id: string;
  codeItem: string;
  partName: string;
  partNumber: string;
  rak: string;
  typeCode: ItemTypeCode;
  txType: TransactionType;
  qty: number;
  prevAkhirQty: number;
  newAkhirQty: number;
  picName: string;
  recipientName?: string;
  unitRef: string;
  notes: string;
  dateStr: string;
  timestampMs: number;
  source: 'QR_SCANNER' | 'MANUAL_ADMIN';
  orgId: string;
  operatorUid: string;
  createdAt?: unknown;
}

export function splitPicAndRecipient(tx: {
  picName: string;
  recipientName?: string;
}): { officer: string; recipient: string } {
  if (tx.recipientName && tx.recipientName.trim()) {
    return {
      officer: tx.picName.split('|')[0].replace(/^Petugas:\s*/i, '').trim(),
      recipient: tx.recipientName.trim(),
    };
  }
  if (tx.picName && tx.picName.includes('|')) {
    const [first, second] = tx.picName.split('|');
    return {
      officer: first.replace(/^Petugas:\s*/i, '').trim(),
      recipient: (second || '').replace(/^(Mekanik\/Penerima|Penerima):\s*/i, '').trim(),
    };
  }
  return {
    officer: tx.picName || 'Petugas Gudang',
    recipient: '-',
  };
}

export const ITEM_TYPE_LABELS: Record<ItemTypeCode, { label: string; desc: string }> = {
  CNU: { label: 'CNU', desc: 'Consumable' },
  SPT: { label: 'SPT', desc: 'Spare Part' },
  PS: { label: 'PS', desc: 'Part Service' },
  LIB: { label: 'LIB', desc: 'Library / Komponen' },
  LUB: { label: 'LUB', desc: 'Lubricant / Oli' },
};

export function calculateAkhirQty(
  awalQty: number,
  inQty: number,
  adjPlusQty: number,
  outQty: number,
  adjMinusQty: number
): number {
  return Math.max(0, awalQty + inQty + adjPlusQty - outQty - adjMinusQty);
}

/**
 * Calculates stock status (ORDER / AMAN / OVER) from Akhir Qty, Safety Min, and Safety Max:
 * - akhirQty <= 0 -> 'ORDER'
 * - minQty === 0 && maxQty === 0 -> 'AMAN' (whenakhirQty > 0)
 * - akhirQty < minQty -> 'ORDER'
 * - maxQty > 0 && akhirQty > maxQty -> 'OVER'
 * - otherwise -> 'AMAN'
 */
export function calculateRemark(akhirQty: number, minQty: number, maxQty: number): StockRemark {
  if (akhirQty <= 0) {
    return 'ORDER';
  }
  if (minQty === 0 && maxQty === 0) {
    return 'AMAN';
  }
  if (akhirQty < minQty) {
    return 'ORDER';
  }
  if (maxQty > 0 && akhirQty > maxQty) {
    return 'OVER';
  }
  return 'AMAN';
}

export function calculateTotalValue(akhirQty: number, price: number): number {
  return Math.max(0, akhirQty * price);
}

export function formatRupiah(amount: number): string {
  return 'Rp' + Math.round(amount).toLocaleString('id-ID');
}

export const FULL_MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const MONTH_LOOKUP: Record<string, number> = {
  jan: 0,
  january: 0,
  januari: 0,
  feb: 1,
  february: 1,
  februari: 1,
  mar: 2,
  march: 2,
  maret: 2,
  apr: 3,
  april: 3,
  may: 4,
  mei: 4,
  jun: 5,
  june: 5,
  juni: 5,
  jul: 6,
  july: 6,
  juli: 6,
  aug: 7,
  august: 7,
  agu: 7,
  ags: 7,
  agustus: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  okt: 9,
  oktober: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
  des: 11,
  desember: 11,
};

/**
 * Formats a Date object into "dd-mmmm-yy" (e.g., "26-September-26", "02-Agustus-24").
 */
export function formatLedgerDate(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mmmm = FULL_MONTH_NAMES_ID[date.getMonth()];
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}-${mmmm}-${yy}`;
}

/**
 * Converts any date string (e.g. "26-Sep-26", "2-Aug-24", "2026-09-30"),
 * Excel serial number, or Date object into "dd-mmmm-yy" format.
 */
export function formatDateDdMmmmYy(raw: unknown, fallbackDate?: Date): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return formatLedgerDate(raw);
  }

  // Handle Excel serial date number (e.g. 45531)
  if (typeof raw === 'number' && raw > 20000 && raw < 90000) {
    const excelEpochMs = Math.round((raw - 25569) * 86400 * 1000);
    const dt = new Date(excelEpochMs);
    if (!Number.isNaN(dt.getTime())) {
      return formatLedgerDate(dt);
    }
  }

  const str = String(raw ?? '').trim();
  if (!str || str === '-') {
    return fallbackDate ? formatLedgerDate(fallbackDate) : '-';
  }

  // Numeric Excel serial as string
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    if (serial > 20000 && serial < 90000) {
      const dt = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (!Number.isNaN(dt.getTime())) {
        return formatLedgerDate(dt);
      }
    }
  }

  // ISO format YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const parts = str.slice(0, 10).split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!Number.isNaN(y) && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      const dd = String(d).padStart(2, '0');
      const mmmm = FULL_MONTH_NAMES_ID[m];
      const yy = String(y).slice(-2);
      return `${dd}-${mmmm}-${yy}`;
    }
  }

  // Standard ledger formats: d-mmm-yy, dd-mmmm-yy, dd/mm/yy, dd-mm-yyyy
  const parts = str.split(/[-/\s]+/);
  if (parts.length >= 2) {
    const dayNum = parseInt(parts[0], 10);
    const rawMonth = parts[1].toLowerCase();
    let monthIdx = MONTH_LOOKUP[rawMonth] ?? MONTH_LOOKUP[rawMonth.slice(0, 3)];
    if (monthIdx === undefined && /^\d{1,2}$/.test(rawMonth)) {
      const mNum = parseInt(rawMonth, 10) - 1;
      if (mNum >= 0 && mNum <= 11) monthIdx = mNum;
    }
    let yearNum = parts[2] ? parseInt(parts[2], 10) : 26;
    if (Number.isNaN(yearNum)) yearNum = 26;
    const yy = String(yearNum).slice(-2).padStart(2, '0');

    if (!Number.isNaN(dayNum) && dayNum >= 1 && dayNum <= 31 && monthIdx !== undefined) {
      const dd = String(dayNum).padStart(2, '0');
      const mmmm = FULL_MONTH_NAMES_ID[monthIdx];
      return `${dd}-${mmmm}-${yy}`;
    }
  }

  return str;
}

/**
 * Parses a ledger date string ("26-September-26", "02-Agustus-24", "2026-09-30", etc.)
 * or Excel serial number into a Date object.
 */
export function parseDateFromLedgerString(raw: unknown, fallbackDate: Date = new Date()): Date {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }

  if (typeof raw === 'number' && raw > 20000 && raw < 90000) {
    const dt = new Date(Math.round((raw - 25569) * 86400 * 1000));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const str = String(raw ?? '').trim();
  if (!str || str === '-') return fallbackDate;

  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    if (serial > 20000 && serial < 90000) {
      const dt = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const parts = str.slice(0, 10).split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!Number.isNaN(y) && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return new Date(y, m, d, 12, 0, 0);
    }
  }

  const parts = str.split(/[-/\s]+/);
  if (parts.length >= 2) {
    const dayNum = parseInt(parts[0], 10);
    const rawMonth = parts[1].toLowerCase();
    let monthIdx = MONTH_LOOKUP[rawMonth] ?? MONTH_LOOKUP[rawMonth.slice(0, 3)];
    if (monthIdx === undefined && /^\d{1,2}$/.test(rawMonth)) {
      const mNum = parseInt(rawMonth, 10) - 1;
      if (mNum >= 0 && mNum <= 11) monthIdx = mNum;
    }
    let yearNum = parts[2] ? parseInt(parts[2], 10) : fallbackDate.getFullYear();
    if (Number.isNaN(yearNum)) yearNum = fallbackDate.getFullYear();
    if (yearNum < 100) yearNum += 2000;

    if (!Number.isNaN(dayNum) && dayNum >= 1 && dayNum <= 31 && monthIdx !== undefined) {
      return new Date(yearNum, monthIdx, dayNum, 12, 0, 0);
    }
  }

  return fallbackDate;
}

/**
 * Calculates movement category from tanggalUpdate relative to today:
 * - < 3 months from today -> 'Fast Moving'
 * - >= 3 months and < 12 months from today -> 'Slow Moving'
 * - >= 12 months from today -> 'Dead Moving'
 */
export function calculateMovementStatus(
  tanggalUpdate: unknown,
  now: Date = new Date()
): MovementCategory {
  const updateDate = parseDateFromLedgerString(tanggalUpdate, now);
  const diffMs = now.getTime() - updateDate.getTime();
  const diffMonths =
    (now.getFullYear() - updateDate.getFullYear()) * 12 +
    (now.getMonth() - updateDate.getMonth()) +
    (now.getDate() - updateDate.getDate()) / 30.4375;

  // If updated in the future or less than 3 months ago
  if (diffMs <= 0 || diffMonths < 3) {
    return 'Fast Moving';
  }
  // Between 3 months and < 12 months ago
  if (diffMonths < 12) {
    return 'Slow Moving';
  }
  // 12 months or more from today
  return 'Dead Moving';
}

export type QrPayloadMode = 'COMBINED' | 'ITEM_CODE' | 'PART_NUMBER' | 'RAK';

/**
 * Splits a partNumber string into an array of distinct Part Numbers
 * (Primary Part Number + Reference / Alternative Part Numbers).
 * Supports separators: " / ", ",", ";", or "|".
 */
export function parsePartNumbers(partNumberStr: string): string[] {
  if (!partNumberStr) return [];
  const rawList = partNumberStr
    .split(/\s*(?:\/|,|;|\|)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '-');
  const unique: string[] = [];
  for (const pn of rawList) {
    if (!unique.some((u) => u.toUpperCase() === pn.toUpperCase())) {
      unique.push(pn);
    }
  }
  return unique.length > 0 ? unique : [partNumberStr.trim() || '-'];
}

/**
 * Formats an array of Part Numbers into a canonical stored string ("PN1 / PN2 / PN3").
 */
export function formatPartNumbers(list: string[]): string {
  const cleaned: string[] = [];
  for (const raw of list) {
    const subParts = parsePartNumbers(raw);
    for (const sp of subParts) {
      if (sp && sp !== '-' && !cleaned.some((c) => c.toUpperCase() === sp.toUpperCase())) {
        cleaned.push(sp);
      }
    }
  }
  return cleaned.length > 0 ? cleaned.join(' / ') : '-';
}

export function encodeItemQrPayload(
  item: Pick<InventoryItem, 'codeItem' | 'partNumber' | 'rak'>,
  mode: QrPayloadMode = 'COMBINED',
  specificPartNumber?: string
): string {
  const pns = parsePartNumbers(item.partNumber);
  const targetPn = specificPartNumber?.trim() || pns[0] || item.partNumber;
  if (mode === 'ITEM_CODE') return item.codeItem;
  if (mode === 'PART_NUMBER') return `PN:${targetPn}`;
  if (mode === 'RAK') return `RAK:${item.rak}`;
  return `GUDANG:${item.codeItem}|PN:${targetPn}|RAK:${item.rak}`;
}

export interface ScannedMatchResult {
  matchedBy: 'CODE_ITEM' | 'PART_NUMBER' | 'RAK' | 'NONE';
  scannedToken: string;
  items: InventoryItem[];
}

function itemHasPartNumber(item: InventoryItem, queryUpper: string): boolean {
  const normQuery = queryUpper.replace(/\s+/g, '');
  const pns = parsePartNumbers(item.partNumber);
  return pns.some((pn) => {
    const u = pn.trim().toUpperCase();
    return u === queryUpper || u.replace(/\s+/g, '') === normQuery;
  });
}

export function resolveScannedItems(
  raw: string,
  inventory: InventoryItem[]
): ScannedMatchResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { matchedBy: 'NONE', scannedToken: '', items: [] };
  }

  // 1. Check explicit prefix PN: or RAK: or GUDANG:
  const upper = trimmed.toUpperCase();

  if (upper.startsWith('PN:') && !upper.includes('|')) {
    const pnVal = trimmed.slice(3).trim().toUpperCase();
    const matches = inventory.filter(
      (i) =>
        itemHasPartNumber(i, pnVal) ||
        i.partNumber.trim().toUpperCase() === pnVal
    );
    if (matches.length > 0) {
      return { matchedBy: 'PART_NUMBER', scannedToken: pnVal, items: matches };
    }
  }

  if (upper.startsWith('RAK:') && !upper.includes('|')) {
    const rakVal = trimmed.slice(4).trim().toUpperCase();
    const matches = inventory.filter(
      (i) => i.rak.trim().toUpperCase() === rakVal
    );
    if (matches.length > 0) {
      return { matchedBy: 'RAK', scannedToken: rakVal, items: matches };
    }
  }

  // 2. Structured GUDANG:DPS-2105|PN:ZMME-0000203|RAK:101A01
  if (upper.startsWith('GUDANG:')) {
    const segments = trimmed.split('|');
    const codeSeg = segments[0].replace(/^GUDANG:/i, '').trim().toUpperCase();
    const byCode = inventory.filter(
      (i) => i.codeItem.trim().toUpperCase() === codeSeg
    );
    if (byCode.length > 0) {
      return { matchedBy: 'CODE_ITEM', scannedToken: codeSeg, items: byCode };
    }
  }

  // 3. Direct match against Code Item (DPS-xxxx)
  const exactCode = inventory.filter(
    (i) => i.codeItem.trim().toUpperCase() === upper
  );
  if (exactCode.length > 0) {
    return { matchedBy: 'CODE_ITEM', scannedToken: upper, items: exactCode };
  }

  // 4. Direct match against any Part Number (Primary or Reference PN)
  const exactPn = inventory.filter(
    (i) =>
      itemHasPartNumber(i, upper) ||
      i.partNumber.trim().toUpperCase() === upper
  );
  if (exactPn.length > 0) {
    const matchedPn =
      parsePartNumbers(exactPn[0].partNumber).find(
        (pn) =>
          pn.toUpperCase() === upper ||
          pn.toUpperCase().replace(/\s+/g, '') === upper.replace(/\s+/g, '')
      ) || exactPn[0].partNumber;
    return {
      matchedBy: 'PART_NUMBER',
      scannedToken: matchedPn,
      items: exactPn,
    };
  }

  // 5. Direct match against Kode Rak (exact)
  const exactRak = inventory.filter(
    (i) => i.rak.trim().toUpperCase() === upper
  );
  if (exactRak.length > 0) {
    return {
      matchedBy: 'RAK',
      scannedToken: exactRak[0].rak,
      items: exactRak,
    };
  }

  // 6. Partial match on any Part Number or Code Item if unique
  const partialPn = inventory.filter(
    (i) =>
      i.partNumber.toUpperCase().includes(upper) ||
      i.codeItem.toUpperCase().includes(upper)
  );
  if (partialPn.length === 1) {
    const matchedBy =
      partialPn[0].partNumber.toUpperCase().includes(upper) &&
      !partialPn[0].codeItem.toUpperCase().includes(upper)
        ? 'PART_NUMBER'
        : 'CODE_ITEM';
    return {
      matchedBy,
      scannedToken: upper,
      items: partialPn,
    };
  }

  return { matchedBy: 'NONE', scannedToken: trimmed, items: [] };
}

export function parseScannedQrCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Support structured format: GUDANG:DPS-2105|PN:...|RAK:...
  if (trimmed.toUpperCase().startsWith('GUDANG:')) {
    const firstSegment = trimmed.split('|')[0];
    return firstSegment.replace(/^GUDANG:/i, '').trim().toUpperCase();
  }

  // Support JSON payload if encoded as JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.codeItem) return String(parsed.codeItem).trim().toUpperCase();
      if (parsed.code) return String(parsed.code).trim().toUpperCase();
      if (parsed.id) return String(parsed.id).trim().toUpperCase();
    } catch {
      // ignore JSON parse error and fallback
    }
  }

  // Support URL query param ?scan=DPS-2105
  if (trimmed.includes('scan=')) {
    const match = trimmed.match(/[?&]scan=([a-zA-Z0-9_-]+)/i);
    if (match?.[1]) return match[1].toUpperCase();
  }

  // Match DPS-xxxx pattern anywhere in string
  const dpsMatch = trimmed.match(/(DPS-\d+)/i);
  if (dpsMatch?.[1]) {
    return dpsMatch[1].toUpperCase();
  }

  return trimmed.toUpperCase();
}
