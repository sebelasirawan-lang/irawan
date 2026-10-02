import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FileText,
  Upload,
  X,
  CheckCircle2,
  AlertTriangle,
  Download,
  Layers,
  RefreshCw,
} from 'lucide-react';
import {
  InventoryItem,
  ItemTypeCode,
  calculateAkhirQty,
  calculateMovementStatus,
  calculateRemark,
  calculateTotalValue,
  formatDateDdMmmmYy,
  formatLedgerDate,
  formatRupiah,
} from '../types/warehouse';

interface ExcelImportModalProps {
  existingCount: number;
  onClose: () => void;
  onConfirmImport: (items: InventoryItem[], mode: 'MERGE' | 'REPLACE') => Promise<void>;
}

function parseNumberCell(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && !Number.isNaN(val)) {
    return Math.max(0, Math.round(val));
  }
  if (typeof val === 'string') {
    const withoutCents = val.trim().replace(/[.,]00$/, '');
    const cleaned = withoutCents.replace(/[^0-9-]/g, '');
    if (!cleaned) return fallback;
    const parsed = parseInt(cleaned, 10);
    return Number.isNaN(parsed) ? fallback : Math.max(0, parsed);
  }
  return fallback;
}

function parseTypeCode(val: unknown): ItemTypeCode {
  const s = String(val ?? '')
    .trim()
    .toUpperCase();
  if (s === 'SPT' || s.includes('SPARE')) return 'SPT';
  if (s === 'PS' || s.includes('SERVICE')) return 'PS';
  return 'CNU';
}

function sanitizeCodeItem(val: unknown, rowIndex: number): string {
  const raw = String(val ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  return raw || `DPS-${String(rowIndex).padStart(4, '0')}`;
}

/**
 * Ensure every item among 3,000+ imported rows gets a unique Code Item
 * so no rows overwrite each other when two rows share a Code Item or have blank codes.
 */
function ensureUniqueCodeItem(baseCode: string, usedCodes: Set<string>, rowNumber: number): string {
  let candidate = baseCode;
  if (!usedCodes.has(candidate)) {
    usedCodes.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (usedCodes.has(`${baseCode}-${suffix}`)) {
    suffix++;
  }
  candidate = `${baseCode}-${suffix}`;
  if (candidate.length > 60) {
    candidate = `DPS-${String(rowNumber).padStart(4, '0')}-${suffix}`;
  }
  usedCodes.add(candidate);
  return candidate;
}

/**
 * RFC-4180 compliant CSV parser that auto-detects comma (,) vs semicolon (;) delimiter
 * and preserves exact string values for 3,000+ rows.
 */
function parseCsvTextToRows(csvText: string): string[][] {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const firstLines = cleanText.split(/\r?\n/).slice(0, 8).join('\n');
  const commaCount = (firstLines.match(/,/g) || []).length;
  const semiCount = (firstLines.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ';' : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    const next = cleanText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function parseWarehouseSheetToItems(rows: unknown[][]): InventoryItem[] {
  const parsedItems: InventoryItem[] = [];
  const usedCodes = new Set<string>();
  const today = formatLedgerDate();

  // Detect header row (supports both single-row header and 2-row split header from Excel/CSV)
  let headerRowIdx = -1;
  const colMap: Record<string, number> = {};

  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const nextRow = Array.isArray(rows[r + 1]) ? rows[r + 1] : [];
    const joined = row.map((c) => String(c ?? '').toLowerCase().trim()).join('|');
    if (
      joined.includes('code item') ||
      joined.includes('part name') ||
      joined.includes('part number') ||
      joined.includes('nama barang') ||
      (joined.includes('item') && joined.includes('rak'))
    ) {
      headerRowIdx = r;
      const maxCols = Math.max(row.length, nextRow.length);
      for (let idx = 0; idx < maxCols; idx++) {
        const topCell = String(row[idx] ?? '').toLowerCase().trim();
        const subCell = String(nextRow[idx] ?? '').toLowerCase().trim();
        const combined = `${topCell} ${subCell}`.trim();
        if (topCell && colMap[topCell] === undefined) colMap[topCell] = idx;
        if (subCell && colMap[subCell] === undefined) colMap[subCell] = idx;
        if (combined && colMap[combined] === undefined) colMap[combined] = idx;
      }
      // If nextRow is the second half of a 2-row header (e.g. starts with 'No' or 'Item'), advance headerRowIdx
      const subCol0 = String(nextRow[0] ?? '').toLowerCase().trim();
      const subCol1 = String(nextRow[1] ?? '').toLowerCase().trim();
      if (subCol0 === 'no' || subCol1 === 'item' || subCol1 === 'code item') {
        headerRowIdx = r + 1;
      }
      break;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 3) continue;

    const col0 = String(row[0] ?? '').trim();
    const col1 = String(row[1] ?? '').trim();
    const col2 = String(row[2] ?? '').trim();
    const col5 = String(row[5] ?? '').trim();
    const col6 = String(row[6] ?? '').trim();

    // Skip legend/header/title rows
    if (
      i <= headerRowIdx ||
      col0.toLowerCase() === 'no' ||
      col1.toLowerCase() === 'code' ||
      col1.toLowerCase() === 'item' ||
      col1.toLowerCase() === 'code item' ||
      col0.startsWith('PT.') ||
      col0.startsWith('CNU =') ||
      col0.startsWith('SPT =') ||
      col0.startsWith('PS =') ||
      (col0 === '' && col1 === '' && col2 === '' && col5 === '' && col6 === '')
    ) {
      continue;
    }

    const itemIndex = parsedItems.length + 1;

    // Case A: Standard 25–29+ column Warehouse Ledger CSV layout
    const isStandardLedgerRow =
      row.length >= 20 &&
      (col1 !== '' || col6 !== '' || col5 !== '' || /^\d+$/.test(col0));

    if (isStandardLedgerRow && headerRowIdx === -1) {
      const no = parseNumberCell(row[0], itemIndex) || itemIndex;
      const baseCode = sanitizeCodeItem(row[1], itemIndex);
      const codeItem = ensureUniqueCodeItem(baseCode, usedCodes, itemIndex);
      const rak = String(row[2] ?? '101A01').trim() || '101A01';
      const typeCode = parseTypeCode(row[3]);
      const modelUnit = String(row[4] ?? 'UNIT').trim() || 'UNIT';
      const partNumber = String(row[5] ?? '-').trim() || '-';
      const partName = String(row[6] ?? 'Part Gudang').trim() || 'Part Gudang';
      const codeUnit = String(row[7] ?? modelUnit).trim() || modelUnit;
      const tanggalUpdate = formatDateDdMmmmYy(row[8] ?? today, new Date());
      const tanggalMasuk = formatDateDdMmmmYy(row[9] ?? today, new Date());
      const tanggalKeluar = formatDateDdMmmmYy(row[10] ?? today, new Date());
      const supplier = String(row[11] ?? '-').trim() || '-';
      const brand = String(row[12] ?? '-').trim() || '-';
      const awalQty = parseNumberCell(row[13], 0);
      const unit = String(row[14] ?? 'Pcs').trim() || 'Pcs';
      const inQty = parseNumberCell(row[15], 0);
      const adjPlusQty = parseNumberCell(row[16], 0);
      const outQty = parseNumberCell(row[17], 0);
      const adjMinusQty = parseNumberCell(row[18], 0);
      const akhirQty = calculateAkhirQty(awalQty, inQty, adjPlusQty, outQty, adjMinusQty);
      const minQty = parseNumberCell(row[21], 0);
      const maxQty = parseNumberCell(row[22], 0);
      const remark = calculateRemark(akhirQty, minQty, maxQty);
      const movementStatus = calculateMovementStatus(tanggalUpdate);
      const price = parseNumberCell(row[25], 0);
      const totalValue = calculateTotalValue(akhirQty, price);
      const rawPriceNote = String(row[27] ?? '').trim();
      const priceNote = price === 0 ? rawPriceNote || '(Update Price)' : '';
      const status1th = movementStatus;

      parsedItems.push({
        id: codeItem,
        no,
        codeItem,
        rak,
        typeCode,
        modelUnit,
        partNumber,
        partName,
        codeUnit,
        tanggalUpdate,
        tanggalMasuk,
        tanggalKeluar,
        supplier,
        brand,
        awalQty,
        unit,
        inQty,
        adjPlusQty,
        outQty,
        adjMinusQty,
        akhirQty,
        minQty,
        maxQty,
        remark,
        movementStatus,
        price,
        totalValue,
        priceNote,
        status1th,
        orgId: 'gudang_utama',
        updatedByUid: 'csv_import',
      });
      continue;
    }

    // Case B: Header-mapped or general CSV rows (supports up to 3,000+ rows with any column order)
    const getCol = (candidates: string[], fallbackIdx: number) => {
      for (const c of candidates) {
        if (colMap[c] !== undefined && row[colMap[c]] !== undefined) {
          return row[colMap[c]];
        }
      }
      return row[fallbackIdx];
    };

    const rawCode = getCol(['code item', 'code item', 'item', 'kode barang', 'kode item', 'code'], 1);
    const rawPartName = getCol(['part name', 'nama barang', 'nama part', 'deskripsi'], 6);
    const rawPartNumber = getCol(['part number', 'pn', 'no part'], 5);

    // Skip completely empty rows that have neither code, part name, nor part number
    if (
      String(rawCode ?? '').trim() === '' &&
      String(rawPartName ?? '').trim() === '' &&
      String(rawPartNumber ?? '').trim() === ''
    ) {
      continue;
    }

    const baseCode = sanitizeCodeItem(rawCode, itemIndex);
    const codeItem = ensureUniqueCodeItem(baseCode, usedCodes, itemIndex);
    const no = parseNumberCell(getCol(['no', 'nomor'], 0), itemIndex) || itemIndex;
    const rak = String(getCol(['code rak', 'rak', 'lokasi', 'lokasi rak'], 2) ?? '101A01').trim() || '101A01';
    const typeCode = parseTypeCode(getCol(['type code', 'type', 'kategori'], 3));
    const modelUnit = String(getCol(['model unit', 'model'], 4) ?? 'UNIT').trim() || 'UNIT';
    const partNumber = String(rawPartNumber ?? '-').trim() || '-';
    const partName = String(rawPartName ?? 'Part Gudang').trim() || 'Part Gudang';
    const codeUnit = String(getCol(['code unit', 'unit alat'], 7) ?? modelUnit).trim() || modelUnit;
    const tanggalUpdate = formatDateDdMmmmYy(getCol(['tanggal update', 'update', 'tgl update'], 8) ?? today, new Date());
    const tanggalMasuk = formatDateDdMmmmYy(getCol(['tanggal masuk', 'masuk', 'tgl masuk'], 9) ?? today, new Date());
    const tanggalKeluar = formatDateDdMmmmYy(getCol(['tanggal keluar', 'keluar', 'tgl keluar'], 10) ?? today, new Date());
    const supplier = String(getCol(['supplier', 'vendor'], 11) ?? '-').trim() || '-';
    const brand = String(getCol(['brand', 'merk'], 12) ?? '-').trim() || '-';
    const awalQty = parseNumberCell(getCol(['awal qty', 'awal', 'stok awal'], 13), 0);
    const unit = String(getCol(['unit', 'satuan'], 14) ?? 'Pcs').trim() || 'Pcs';
    const inQty = parseNumberCell(getCol(['in qty', 'in', 'masuk qty'], 15), 0);
    const adjPlusQty = parseNumberCell(getCol(['penyesuaian (+) qty', 'penyesuaian (+) qty', '(+) qty', 'adj (+)'], 16), 0);
    const outQty = parseNumberCell(getCol(['out qty', 'out', 'keluar qty'], 17), 0);
    const adjMinusQty = parseNumberCell(getCol(['penyesuaian (-) qty', 'penyesuaian (-) qty', '(-) qty', 'adj (-)'], 18), 0);
    const akhirQty = calculateAkhirQty(awalQty, inQty, adjPlusQty, outQty, adjMinusQty);
    const minQty = parseNumberCell(getCol(['min', 'min qty'], 21), 0);
    const maxQty = parseNumberCell(getCol(['max', 'max qty'], 22), 0);
    const remark = calculateRemark(akhirQty, minQty, maxQty);
    const movementStatus = calculateMovementStatus(tanggalUpdate);
    const price = parseNumberCell(getCol(['price', 'price (rp)', 'harga', 'harga satuan'], 25), 0);
    const totalValue = calculateTotalValue(akhirQty, price);

    parsedItems.push({
      id: codeItem,
      no,
      codeItem,
      rak,
      typeCode,
      modelUnit,
      partNumber,
      partName,
      codeUnit,
      tanggalUpdate,
      tanggalMasuk,
      tanggalKeluar,
      supplier,
      brand,
      awalQty,
      unit,
      inQty,
      adjPlusQty,
      outQty,
      adjMinusQty,
      akhirQty,
      minQty,
      maxQty,
      remark,
      movementStatus,
      price,
      totalValue,
      priceNote: price === 0 ? '(Update Price)' : '',
      status1th: movementStatus,
      orgId: 'gudang_utama',
      updatedByUid: 'csv_import',
    });
  }

  return parsedItems;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  existingCount,
  onClose,
  onConfirmImport,
}) => {
  const [fileName, setFileName] = useState<string>('');
  const [previewItems, setPreviewItems] = useState<InventoryItem[]>([]);
  const [importMode, setImportMode] = useState<'MERGE' | 'REPLACE'>('MERGE');
  const [parseError, setParseError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processCsvFile(file);
    e.target.value = '';
  };

  const processCsvFile = (file: File) => {
    setFileName(file.name);
    setParseError(null);

    const isCsv = file.name.toLowerCase().endsWith('.csv');

    if (isCsv) {
      const textReader = new FileReader();
      textReader.onload = (evt) => {
        try {
          const text = String(evt.target?.result ?? '');
          if (!text.trim()) throw new Error('File CSV kosong');
          const rows = parseCsvTextToRows(text);
          const items = parseWarehouseSheetToItems(rows);
          if (items.length === 0) {
            setParseError(
              'Tidak ditemukan baris data barang yang valid pada file CSV. Pastikan kolom Code Item (cth: DPS-2105) dan Part Name terisi.'
            );
            setPreviewItems([]);
          } else {
            setPreviewItems(items);
          }
        } catch (err) {
          setParseError(
            err instanceof Error
              ? `Gagal membaca file CSV: ${err.message}`
              : 'Format file CSV tidak dikenali.'
          );
          setPreviewItems([]);
        }
      };
      textReader.readAsText(file, 'utf-8');
      return;
    }

    // Fallback support if user picks a spreadsheet file
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        if (!data) throw new Error('File kosong');
        const workbook = XLSX.read(data, { type: 'array', raw: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
          header: 1,
          defval: '',
        });

        const items = parseWarehouseSheetToItems(rows);
        if (items.length === 0) {
          setParseError(
            'Tidak ditemukan baris data barang yang valid. Pastikan kolom Code Item (cth: DPS-2105) dan Part Name terisi.'
          );
          setPreviewItems([]);
        } else {
          setPreviewItems(items);
        }
      } catch (err) {
        setParseError(
          err instanceof Error
            ? `Gagal membaca file CSV: ${err.message}`
            : 'Format file CSV tidak dikenali.'
        );
        setPreviewItems([]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDownloadTemplateCsv = () => {
    const headers = [
      'No',
      'Code Item',
      'Code Rak',
      'Type Code',
      'Model Unit',
      'Part Number',
      'Part Name',
      'CODE UNIT',
      'Tanggal Update',
      'Tanggal Masuk',
      'Tanggal Keluar',
      'Supplier',
      'Brand',
      'Awal Qty',
      'Unit',
      'IN Qty',
      'Penyesuaian (+) Qty',
      'OUT Qty',
      'Penyesuaian (-) Qty',
      'Akhir Qty',
      'Unit Akhir',
      'MIN',
      'MAX',
      'REMARK',
      '9/30/2026',
      'Price',
      'Total',
      'Note',
      'Status 1th',
    ];

    const sampleRows = [
      [
        1,
        'DPS-2105',
        '"101A01"',
        'CNU',
        '"POMPA"',
        '"ZMME-0000203"',
        '"Karet Kopling F3"',
        '"Water Pump"',
        '26-September-26',
        '11-September-26',
        '26-September-26',
        '"Jaya Putra Mandiri"',
        '"N-BK"',
        41,
        'Pcs',
        39,
        0,
        76,
        0,
        4,
        'Pcs',
        20,
        30,
        'ORDER',
        'Fast Moving',
        32500,
        130000,
        '',
        'Fast Moving',
      ],
      [
        2,
        'DPS-2314',
        '"101A02"',
        'CNU',
        '"POMPA"',
        '"ZMME-0000204"',
        '"Karet Kopling F4"',
        '"Water Pump"',
        '28-September-26',
        '22-August-26',
        '28-September-26',
        '"Jaya Putra Mandiri"',
        '"N-BK"',
        34,
        'Pcs',
        73,
        27,
        102,
        0,
        32,
        'Pcs',
        1,
        2,
        'OVER',
        'Fast Moving',
        40000,
        1280000,
        '',
        'Fast Moving',
      ],
    ];

    const csvString = [headers.join(','), ...sampleRows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Template_Import_Gudang_MME.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleConfirm = async () => {
    if (previewItems.length === 0) return;
    setIsImporting(true);
    try {
      await onConfirmImport(previewItems, importMode);
      onClose();
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                Import Data Inventaris dari CSV (.csv) — Kapasitas 3.000+ Item
              </h3>
              <p className="text-xs text-slate-400">
                Otomatis membaca ribuan baris CSV gudang, membuat QR Code, dan menyinkronkan ke Dashboard
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload Dropzone & Template Button */}
        <div className="mt-5 space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const droppedFile = e.dataTransfer.files?.[0];
              if (droppedFile) processCsvFile(droppedFile);
            }}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-emerald-500/60 bg-slate-950/70 rounded-xl p-6 text-center cursor-pointer transition"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3 text-emerald-400">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-200">
              {fileName
                ? `File CSV Terpilih: ${fileName}`
                : 'Klik untuk Pilih File CSV (.csv) atau Tarik File ke Sini'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Siap memuat hingga <strong className="text-emerald-300">3.000+ item barang</strong> sekaligus (format pemisah koma <code className="text-slate-300">,</code> maupun titik koma <code className="text-slate-300">;</code>)
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
            <span className="text-xs text-slate-400">
              Belum punya format CSV yang sesuai? Unduh contoh template CSV siap pakai:
            </span>
            <button
              type="button"
              onClick={handleDownloadTemplateCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 font-semibold text-xs transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download Template CSV (.csv)
            </button>
          </div>

          {parseError && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Preview Parsed Items */}
          {previewItems.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Berhasil membaca {previewItems.length.toLocaleString('id-ID')} baris barang dari file CSV!
                  </span>
                </div>

                {/* Mode Selector */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setImportMode('MERGE')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                      importMode === 'MERGE'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Gabungkan / Update ({existingCount.toLocaleString('id-ID')} data lama)
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('REPLACE')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                      importMode === 'REPLACE'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Ganti Semua Data
                  </button>
                </div>
              </div>

              {previewItems.length > 100 && (
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-1.5">
                  Menampilkan pratinjau 100 baris pertama dari total{' '}
                  <strong className="text-amber-300">
                    {previewItems.length.toLocaleString('id-ID')} item
                  </strong>{' '}
                  (seluruh {previewItems.length.toLocaleString('id-ID')} item akan diimpor penuh saat tombol Import diklik).
                </div>
              )}

              {/* Preview Table */}
              <div className="max-h-56 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">No</th>
                      <th className="py-2 px-3">Code Item</th>
                      <th className="py-2 px-3">Rak</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Part Name & PN</th>
                      <th className="py-2 px-3 text-right">Awal/IN/OUT</th>
                      <th className="py-2 px-3 text-right">Akhir</th>
                      <th className="py-2 px-3 text-center">Remark</th>
                      <th className="py-2 px-3 text-right">Harga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {previewItems.slice(0, 100).map((item) => (
                      <tr key={item.codeItem}>
                        <td className="py-2 px-3 font-mono text-slate-400">{item.no}</td>
                        <td className="py-2 px-3 font-mono font-bold text-amber-400">
                          {item.codeItem}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-300">{item.rak}</td>
                        <td className="py-2 px-3 font-mono text-slate-300">{item.typeCode}</td>
                        <td className="py-2 px-3">
                          <div className="font-semibold text-slate-200">{item.partName}</div>
                          <div className="font-mono text-[10px] text-slate-500">
                            {item.partNumber}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-[11px] text-slate-400">
                          {item.awalQty} / +{item.inQty} / -{item.outQty}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-100">
                          {item.akhirQty} {item.unit}
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-[10px]">
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold ${
                              item.remark === 'ORDER'
                                ? 'bg-rose-500/20 text-rose-300'
                                : item.remark === 'AMAN'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {item.remark}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-300">
                          {item.price > 0 ? formatRupiah(item.price) : item.priceNote}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="flex items-center justify-end gap-2.5 mt-6 pt-4 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={previewItems.length === 0 || isImporting}
            onClick={handleConfirm}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs transition cursor-pointer shadow-md"
          >
            <Upload className="w-4 h-4" />
            {isImporting
              ? `Mengimpor ${previewItems.length.toLocaleString('id-ID')} Barang...`
              : `Import ${previewItems.length.toLocaleString('id-ID')} Barang dari CSV`}
          </button>
        </div>
      </div>
    </div>
  );
};
