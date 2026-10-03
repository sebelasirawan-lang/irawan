import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  X,
  Download,
  Upload,
  FileText,
  Plus,
  Trash2,
  Save,
  Search,
  Table,
  Code2,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  InventoryItem,
  ItemTypeCode,
  TransactionType,
  WarehouseTransaction,
  formatDateDdMmmmYy,
  formatLedgerDate,
  splitPicAndRecipient,
} from '../types/warehouse';

interface LogCsvEditorModalProps {
  transactions: WarehouseTransaction[];
  items: InventoryItem[];
  onClose: () => void;
  onSaveTransactions: (updatedTransactions: WarehouseTransaction[]) => Promise<void> | void;
  onDownloadCsv: (txList: WarehouseTransaction[]) => void;
}

const CSV_HEADERS = [
  'No',
  'ID Transaksi',
  'Tanggal',
  'Metode',
  'Tipe Transaksi',
  'Code Item',
  'Code Rak',
  'Type Code',
  'Part Name',
  'Part Number',
  'Qty',
  'Stok Sebelum',
  'Stok Sesudah',
  'Nama Mekanik Pengambil',
  'Code Unit',
  'PIC Logistik',
  'Catatan',
];

function escapeCsvCell(val: string | number | undefined | null): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeTransactionsToCsv(
  txList: WarehouseTransaction[],
  masterMap: Map<string, InventoryItem>
): string {
  const rows = txList.map((tx, idx) => {
    const { officer, recipient } = splitPicAndRecipient(tx);
    const master = masterMap.get(tx.codeItem.toUpperCase());
    const resolvedUnit =
      tx.unitRef && tx.unitRef.trim() && tx.unitRef.trim() !== '-'
        ? tx.unitRef.trim()
        : master?.codeUnit || master?.modelUnit || '-';

    return [
      idx + 1,
      escapeCsvCell(tx.id),
      escapeCsvCell(formatDateDdMmmmYy(tx.dateStr)),
      escapeCsvCell(tx.source === 'QR_SCANNER' ? 'QR_SCANNER' : 'MANUAL_ADMIN'),
      escapeCsvCell(tx.txType),
      escapeCsvCell(tx.codeItem),
      escapeCsvCell(tx.rak),
      escapeCsvCell(tx.typeCode),
      escapeCsvCell(tx.partName),
      escapeCsvCell(tx.partNumber),
      tx.qty,
      tx.prevAkhirQty,
      tx.newAkhirQty,
      escapeCsvCell(recipient),
      escapeCsvCell(resolvedUnit),
      escapeCsvCell(officer),
      escapeCsvCell(tx.notes),
    ].join(',');
  });

  return [CSV_HEADERS.join(','), ...rows].join('\n');
}

function parseCsvTextToTransactions(
  csvText: string,
  existingTransactions: WarehouseTransaction[],
  masterMap: Map<string, InventoryItem>
): WarehouseTransaction[] {
  const wb = XLSX.read(csvText, { type: 'string', raw: true });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  if (!firstSheet) return existingTransactions;

  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (rows.length <= 1) return [];

  const existingById = new Map<string, WarehouseTransaction>();
  existingTransactions.forEach((t) => existingById.set(t.id, t));

  // Detect header row
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const lineStr = (rows[i] || []).map((c) => String(c).toLowerCase()).join(' ');
    if (
      lineStr.includes('code item') ||
      lineStr.includes('part name') ||
      lineStr.includes('tipe') ||
      lineStr.includes('tanggal')
    ) {
      headerRowIdx = i;
      break;
    }
  }

  const headerCells = (rows[headerRowIdx] || []).map((h) =>
    String(h ?? '')
      .trim()
      .toLowerCase()
  );

  const findCol = (keywords: string[], fallbackIdx: number): number => {
    const found = headerCells.findIndex((h) =>
      keywords.some((kw) => h === kw || h.includes(kw))
    );
    return found >= 0 ? found : fallbackIdx;
  };

  const idxId = findCol(['id transaksi', 'id_transaksi', 'id'], 1);
  const idxDate = findCol(['tanggal', 'date'], 2);
  const idxSource = findCol(['metode', 'source'], 3);
  const idxType = findCol(['tipe transaksi', 'tipe', 'txtype', 'arus'], 4);
  const idxCode = findCol(['code item', 'kode item', 'code_item'], 5);
  const idxRak = findCol(['code rak', 'lokasi rak', 'rak'], 6);
  const idxCat = findCol(['type code', 'kategori', 'type'], 7);
  const idxName = findCol(['part name', 'nama barang', 'nama part'], 8);
  const idxPn = findCol(['part number', 'pn'], 9);
  const idxQty = findCol(['qty transaksi', 'qty', 'jumlah'], 10);
  const idxPrev = findCol(['stok sebelum', 'prev', 'awal'], 11);
  const idxNew = findCol(['stok sesudah', 'new', 'akhir'], 12);
  const idxMechanic = findCol(['nama mekanik', 'mekanik', 'pengambil', 'penerima'], 13);
  const idxCodeUnit = findCol(['code unit', 'unit ref', 'model unit'], 14);
  const idxPic = findCol(['pic logistik', 'petugas', 'pic'], 15);
  const idxNotes = findCol(['catatan', 'keterangan', 'note'], 16);

  const parsedList: WarehouseTransaction[] = [];

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const rawCode = String(row[idxCode] ?? '').trim().toUpperCase();
    const rawName = String(row[idxName] ?? '').trim();
    if (!rawCode && !rawName) continue;

    const rawId = String(row[idxId] ?? '').trim();
    const existing = rawId ? existingById.get(rawId) : undefined;
    const master = masterMap.get(rawCode);

    const rawTypeStr = String(row[idxType] ?? 'OUT')
      .trim()
      .toUpperCase();
    let txType: TransactionType = 'OUT';
    if (rawTypeStr.includes('ADJ') && rawTypeStr.includes('+')) txType = 'ADJ_PLUS';
    else if (rawTypeStr.includes('ADJ') && rawTypeStr.includes('-')) txType = 'ADJ_MINUS';
    else if (rawTypeStr.includes('IN') || rawTypeStr.includes('MASUK')) txType = 'IN';
    else if (rawTypeStr.includes('OUT') || rawTypeStr.includes('KELUAR')) txType = 'OUT';

    const rawCatStr = String(row[idxCat] ?? master?.typeCode ?? 'SPT')
      .trim()
      .toUpperCase();
    const typeCode: ItemTypeCode =
      rawCatStr === 'CNU' || rawCatStr === 'SPT' || rawCatStr === 'PS'
        ? rawCatStr
        : master?.typeCode || 'SPT';

    const qty = Math.max(0, parseInt(String(row[idxQty] ?? '1').replace(/[^\d-]/g, ''), 10) || 1);
    const prevAkhirQty =
      parseInt(String(row[idxPrev] ?? '0').replace(/[^\d-]/g, ''), 10) || 0;
    const newAkhirQty =
      parseInt(String(row[idxNew] ?? '0').replace(/[^\d-]/g, ''), 10) ||
      (txType === 'IN' || txType === 'ADJ_PLUS'
        ? prevAkhirQty + qty
        : Math.max(0, prevAkhirQty - qty));

    const dateRaw = String(row[idxDate] ?? '').trim();
    const dateStr = dateRaw ? formatDateDdMmmmYy(dateRaw) : formatLedgerDate();

    const sourceRaw = String(row[idxSource] ?? '')
      .trim()
      .toUpperCase();
    const source: 'QR_SCANNER' | 'MANUAL_ADMIN' =
      sourceRaw.includes('QR') ? 'QR_SCANNER' : 'MANUAL_ADMIN';

    const recipientName = String(row[idxMechanic] ?? '-').trim() || '-';
    const unitRef =
      String(row[idxCodeUnit] ?? '').trim() ||
      master?.codeUnit ||
      master?.modelUnit ||
      '-';
    const picName = String(row[idxPic] ?? 'Petugas Gudang').trim() || 'Petugas Gudang';
    const notes = String(row[idxNotes] ?? '').trim();

    parsedList.push({
      id: existing?.id || rawId || `tx-csv-${Date.now()}-${r}`,
      codeItem: rawCode || master?.codeItem || `ITEM-${r}`,
      partName: rawName || master?.partName || 'Sparepart Gudang',
      partNumber: String(row[idxPn] ?? master?.partNumber ?? '-').trim() || '-',
      rak: String(row[idxRak] ?? master?.rak ?? '-').trim() || '-',
      typeCode,
      txType,
      qty,
      prevAkhirQty,
      newAkhirQty,
      picName,
      recipientName,
      unitRef,
      notes,
      dateStr,
      timestampMs: existing?.timestampMs || Date.now() - r * 1000,
      source,
      orgId: existing?.orgId || 'org-mme-main',
      operatorUid: existing?.operatorUid || 'csv-editor',
    });
  }

  return parsedList;
}

export const LogCsvEditorModal: React.FC<LogCsvEditorModalProps> = ({
  transactions,
  items,
  onClose,
  onSaveTransactions,
  onDownloadCsv,
}) => {
  const masterMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    items.forEach((it) => map.set(it.codeItem.toUpperCase(), it));
    return map;
  }, [items]);

  const [draftTransactions, setDraftTransactions] = useState<WarehouseTransaction[]>(() =>
    transactions.map((tx) => {
      const { officer, recipient } = splitPicAndRecipient(tx);
      const master = masterMap.get(tx.codeItem.toUpperCase());
      return {
        ...tx,
        picName: officer,
        recipientName: recipient,
        unitRef:
          tx.unitRef && tx.unitRef.trim() && tx.unitRef.trim() !== '-'
            ? tx.unitRef
            : master?.codeUnit || master?.modelUnit || '-',
      };
    })
  );

  const [editorMode, setEditorMode] = useState<'TABLE' | 'RAW_CSV'>('TABLE');
  const [rawCsvText, setRawCsvText] = useState<string>(() =>
    serializeTransactionsToCsv(transactions, masterMap)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'warning';
    text: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredDrafts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return draftTransactions;
    return draftTransactions.filter(
      (t) =>
        t.codeItem.toLowerCase().includes(q) ||
        t.partName.toLowerCase().includes(q) ||
        t.partNumber.toLowerCase().includes(q) ||
        t.picName.toLowerCase().includes(q) ||
        (t.recipientName || '').toLowerCase().includes(q) ||
        t.unitRef.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q)
    );
  }, [draftTransactions, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredDrafts.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedDrafts = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredDrafts.slice(start, start + pageSize);
  }, [filteredDrafts, safePage, pageSize]);

  const switchToMode = (nextMode: 'TABLE' | 'RAW_CSV') => {
    if (nextMode === 'RAW_CSV' && editorMode === 'TABLE') {
      setRawCsvText(serializeTransactionsToCsv(draftTransactions, masterMap));
    } else if (nextMode === 'TABLE' && editorMode === 'RAW_CSV') {
      const parsed = parseCsvTextToTransactions(rawCsvText, draftTransactions, masterMap);
      setDraftTransactions(parsed);
    }
    setEditorMode(nextMode);
  };

  const handleFieldChange = (
    id: string,
    field: keyof WarehouseTransaction,
    value: string | number
  ) => {
    setDraftTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== id) return tx;
        const updated: WarehouseTransaction = { ...tx, [field]: value };

        // Auto-populate part details if codeItem matches Master Inventory
        if (field === 'codeItem') {
          const codeUpper = String(value).trim().toUpperCase();
          updated.codeItem = codeUpper;
          const matched = masterMap.get(codeUpper);
          if (matched) {
            updated.partName = matched.partName;
            updated.partNumber = matched.partNumber;
            updated.rak = matched.rak;
            updated.typeCode = matched.typeCode;
            if (!updated.unitRef || updated.unitRef === '-') {
              updated.unitRef = matched.codeUnit || matched.modelUnit || '-';
            }
          }
        }

        // Recalculate newAkhirQty when qty, prevAkhirQty, or txType changes
        if (field === 'qty' || field === 'prevAkhirQty' || field === 'txType') {
          const q = field === 'qty' ? Number(value) || 0 : updated.qty;
          const p =
            field === 'prevAkhirQty' ? Number(value) || 0 : updated.prevAkhirQty;
          const t =
            field === 'txType' ? (value as TransactionType) : updated.txType;
          updated.newAkhirQty =
            t === 'IN' || t === 'ADJ_PLUS' ? p + q : Math.max(0, p - q);
        }

        return updated;
      })
    );
  };

  const handleAddRow = () => {
    const sampleItem = items[0];
    const newRow: WarehouseTransaction = {
      id: `tx-manual-${Date.now()}`,
      codeItem: sampleItem?.codeItem || 'DPS-2105',
      partName: sampleItem?.partName || 'Nama Barang',
      partNumber: sampleItem?.partNumber || '-',
      rak: sampleItem?.rak || 'A1',
      typeCode: sampleItem?.typeCode || 'SPT',
      txType: 'OUT',
      qty: 1,
      prevAkhirQty: sampleItem?.akhirQty ?? 10,
      newAkhirQty: Math.max(0, (sampleItem?.akhirQty ?? 10) - 1),
      picName: 'Irawan',
      recipientName: '-',
      unitRef: sampleItem?.codeUnit || sampleItem?.modelUnit || '-',
      notes: 'Input / Edit CSV Log Harian',
      dateStr: formatLedgerDate(),
      timestampMs: Date.now(),
      source: 'MANUAL_ADMIN',
      orgId: 'org-mme-main',
      operatorUid: 'csv-editor',
    };
    setDraftTransactions((prev) => [newRow, ...prev]);
    setPage(1);
    setStatusMessage({
      type: 'success',
      text: 'Baris transaksi baru ditambahkan di urutan teratas.',
    });
  };

  const handleDeleteRow = (id: string) => {
    setDraftTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const handleUploadCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = String(evt.target?.result ?? '');
      const parsed = parseCsvTextToTransactions(text, draftTransactions, masterMap);
      setDraftTransactions(parsed);
      setRawCsvText(serializeTransactionsToCsv(parsed, masterMap));
      setStatusMessage({
        type: 'success',
        text: `Berhasil memuat ${parsed.length} baris log transaksi dari file "${file.name}". Silakan tinjau & klik Simpan Perubahan.`,
      });
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const handleDownloadCurrentDraftCsv = () => {
    const finalTx =
      editorMode === 'RAW_CSV'
        ? parseCsvTextToTransactions(rawCsvText, draftTransactions, masterMap)
        : draftTransactions;
    onDownloadCsv(finalTx);
    setStatusMessage({
      type: 'success',
      text: `File CSV Log Harian (${finalTx.length} transaksi) berhasil diunduh.`,
    });
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const finalTx =
        editorMode === 'RAW_CSV'
          ? parseCsvTextToTransactions(rawCsvText, draftTransactions, masterMap)
          : draftTransactions;
      await onSaveTransactions(finalTx);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-[1480px] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                Editor & Import/Export CSV — Log Transaksi Harian
              </h3>
              <p className="text-xs text-slate-400">
                Edit langsung setiap kolom transaksi di tabel CSV, unggah file <code className="text-amber-300">.csv</code> hasil edit, atau unduh ke CSV
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Mode Switcher */}
            <div className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => switchToMode('TABLE')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  editorMode === 'TABLE'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                Tabel Editor CSV ({draftTransactions.length})
              </button>
              <button
                type="button"
                onClick={() => switchToMode('RAW_CSV')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  editorMode === 'RAW_CSV'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                Edit Teks CSV Mentah
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              title="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-Toolbar: Search, Add Row, Upload CSV, Download CSV */}
        <div className="px-5 py-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
            {editorMode === 'TABLE' && (
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Cari Code Item, Part Name, Mekanik, Unit, PIC..."
                  className="w-full h-9 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg pl-9 pr-3 text-xs text-slate-100 outline-none"
                />
              </div>
            )}

            {editorMode === 'TABLE' && (
              <button
                type="button"
                onClick={handleAddRow}
                className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-xs font-bold transition cursor-pointer"
              >
                <Plus className="w-4 h-4 text-emerald-400" />
                Tambah Baris Log
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleUploadCsvFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/35 text-blue-200 text-xs font-semibold transition cursor-pointer"
              title="Muat file CSV Log Harian yang telah diedit di Excel"
            >
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              Buka / Upload File CSV (.csv)
            </button>

            <button
              type="button"
              onClick={handleDownloadCurrentDraftCsv}
              className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
              title="Download data tabel ini ke file CSV"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              Download CSV
            </button>
          </div>
        </div>

        {/* Status Banner */}
        {statusMessage && (
          <div
            className={`px-5 py-2 text-xs flex items-center justify-between border-b ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Main Editor Body */}
        <div className="flex-1 overflow-auto p-4">
          {editorMode === 'TABLE' ? (
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-2.5 px-2 text-center w-10">No</th>
                      <th className="py-2.5 px-2 min-w-[120px]">Tanggal</th>
                      <th className="py-2.5 px-2 min-w-[125px]">Tipe</th>
                      <th className="py-2.5 px-2 min-w-[115px]">Code Item</th>
                      <th className="py-2.5 px-2 min-w-[85px]">Rak</th>
                      <th className="py-2.5 px-2 min-w-[180px]">Part Name</th>
                      <th className="py-2.5 px-2 min-w-[130px]">Part Number</th>
                      <th className="py-2.5 px-2 text-right min-w-[75px]">Qty</th>
                      <th className="py-2.5 px-2 text-right min-w-[80px]">Stok Awal</th>
                      <th className="py-2.5 px-2 text-right min-w-[80px]">Stok Akhir</th>
                      <th className="py-2.5 px-2 min-w-[145px] text-amber-300">
                        Nama Mekanik Pengambil
                      </th>
                      <th className="py-2.5 px-2 min-w-[125px] text-cyan-300">
                        Code Unit
                      </th>
                      <th className="py-2.5 px-2 min-w-[135px] text-emerald-300">
                        PIC Logistik
                      </th>
                      <th className="py-2.5 px-2 min-w-[160px]">Catatan</th>
                      <th className="py-2.5 px-2 text-center w-12">Hapus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {paginatedDrafts.map((tx, idx) => {
                      const rowNumber = (safePage - 1) * pageSize + idx + 1;
                      return (
                        <tr key={tx.id} className="hover:bg-slate-900/70">
                          <td className="py-2 px-2 text-center font-mono text-slate-500">
                            {rowNumber}
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.dateStr}
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'dateStr', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 font-mono text-xs text-slate-100 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <select
                              value={tx.txType}
                              onChange={(e) =>
                                handleFieldChange(
                                  tx.id,
                                  'txType',
                                  e.target.value as TransactionType
                                )
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 font-mono text-xs font-bold text-slate-100 outline-none"
                            >
                              <option value="IN">MASUK (+IN)</option>
                              <option value="OUT">KELUAR (-OUT)</option>
                              <option value="ADJ_PLUS">ADJ (+)</option>
                              <option value="ADJ_MINUS">ADJ (-)</option>
                            </select>
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.codeItem}
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'codeItem', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 font-mono font-bold text-amber-400 text-xs outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.rak}
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'rak', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 font-mono text-xs text-slate-200 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.partName}
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'partName', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 text-xs font-semibold text-slate-100 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.partNumber}
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'partNumber', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 font-mono text-xs text-slate-300 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="number"
                              min={0}
                              value={tx.qty}
                              onChange={(e) =>
                                handleFieldChange(
                                  tx.id,
                                  'qty',
                                  Math.max(0, parseInt(e.target.value, 10) || 0)
                                )
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 text-right font-mono font-bold text-xs text-slate-100 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="number"
                              min={0}
                              value={tx.prevAkhirQty}
                              onChange={(e) =>
                                handleFieldChange(
                                  tx.id,
                                  'prevAkhirQty',
                                  Math.max(0, parseInt(e.target.value, 10) || 0)
                                )
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 text-right font-mono text-xs text-slate-300 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="number"
                              min={0}
                              value={tx.newAkhirQty}
                              onChange={(e) =>
                                handleFieldChange(
                                  tx.id,
                                  'newAkhirQty',
                                  Math.max(0, parseInt(e.target.value, 10) || 0)
                                )
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 text-right font-mono font-bold text-xs text-slate-100 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.recipientName || ''}
                              placeholder="Nama mekanik..."
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'recipientName', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-amber-500/30 focus:border-amber-400 rounded px-2 py-1 text-xs font-semibold text-amber-200 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.unitRef}
                              placeholder="Code unit..."
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'unitRef', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-cyan-500/30 focus:border-cyan-400 rounded px-2 py-1 font-mono text-xs font-semibold text-cyan-200 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.picName}
                              placeholder="PIC Logistik..."
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'picName', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-emerald-500/30 focus:border-emerald-400 rounded px-2 py-1 text-xs font-semibold text-emerald-200 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              value={tx.notes}
                              placeholder="Catatan..."
                              onChange={(e) =>
                                handleFieldChange(tx.id, 'notes', e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500 rounded px-2 py-1 text-xs text-slate-200 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(tx.id)}
                              className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition cursor-pointer"
                              title="Hapus baris ini dari draft CSV"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination inside CSV Table Editor */}
              {totalPages > 1 && (
                <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-400">
                    Menampilkan {(safePage - 1) * pageSize + 1}–
                    {Math.min(safePage * pageSize, filteredDrafts.length)} dari{' '}
                    <strong className="text-amber-400">{filteredDrafts.length}</strong> baris CSV
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Sebelumnya
                    </button>
                    <span className="font-mono px-2 text-slate-300">
                      Hal {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      Berikutnya
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 h-full flex flex-col">
              <div className="text-xs text-slate-400 flex items-center justify-between">
                <span>
                  Format Header CSV: <code className="text-amber-300">{CSV_HEADERS.join(', ')}</code>
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  Pemisah koma (,) atau titik koma (;) didukung otomatis
                </span>
              </div>
              <textarea
                value={rawCsvText}
                onChange={(e) => setRawCsvText(e.target.value)}
                rows={18}
                className="w-full flex-1 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl p-3.5 font-mono text-xs text-slate-200 outline-none leading-relaxed"
                placeholder="Tempel atau edit teks CSV Log Harian di sini..."
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            Total baris di editor:{' '}
            <strong className="text-slate-100 font-mono">{draftTransactions.length}</strong>{' '}
            Log Transaksi Harian
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleDownloadCurrentDraftCsv}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-amber-300 text-xs font-bold transition cursor-pointer"
            >
              <Download className="w-4 h-4 text-amber-400" />
              Download CSV Hasil Edit
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveAll}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold transition cursor-pointer shadow-lg shadow-amber-500/20"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Menyimpan...' : 'Simpan Perubahan CSV ke Log Harian'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
