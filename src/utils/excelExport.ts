import * as XLSX from 'xlsx';
import {
  InventoryItem,
  WarehouseTransaction,
  formatLedgerDate,
  formatRupiah,
  ITEM_TYPE_LABELS,
} from '../types/warehouse';

export interface PeriodSummaryItem {
  item: InventoryItem;
  periodIn: number;
  periodOut: number;
  periodAdjPlus: number;
  periodAdjMinus: number;
  txCount: number;
  periodInValue: number;
  periodOutValue: number;
}

/**
 * Exports the complete Master Warehouse Inventory & Transaction History to a multi-sheet .xlsx file
 * matching the exact layout of the original warehouse spreadsheet.
 */
export function exportMasterInventoryToExcel(
  items: InventoryItem[],
  transactions: WarehouseTransaction[]
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Master Inventaris Gudang (Matching exact original spreadsheet layout)
  const masterRows: (string | number)[][] = [
    ['', '', '', '', '', '', '', '', '', 'CNU = Consumable'],
    ['', '', '', '', '', '', '', '', '', 'SPT = Spare Part'],
    ['', '', '', '', '', '', '', '', '', 'PS = Part Service'],
    [
      '',
      'Code',
      'Code',
      'Type',
      'Model Unit',
      'Part Number',
      'Part Name',
      'CODE UNIT',
      'Tanggal',
      'Tanggal',
      'Tanggal',
      'Supplier',
      'Brand',
      'Awal',
      '',
      'IN',
      'Penyesuaian',
      'OUT',
      'Penyesuaian',
      'Akhir',
      '',
      '',
      'ORDER',
      '',
      '',
      '',
      '',
      '',
    ],
    [
      'No',
      'Item',
      'Rak',
      'Code',
      '',
      '',
      '',
      '',
      'Update',
      'Masuk',
      'Keluar',
      '',
      '',
      'Qty',
      'Unit',
      'Qty',
      '(+) Qty',
      'Qty',
      '(-) Qty',
      'Qty',
      'Unit',
      'MIN',
      'MAX',
      'REMARK',
      '9/30/2026',
      'Price',
      'Total',
      'Note',
      'Status 1th',
    ],
  ];

  for (const item of items) {
    masterRows.push([
      item.no,
      item.codeItem,
      item.rak,
      item.typeCode,
      item.modelUnit,
      item.partNumber,
      item.partName,
      item.codeUnit,
      item.tanggalUpdate,
      item.tanggalMasuk,
      item.tanggalKeluar,
      item.supplier,
      item.brand,
      item.awalQty,
      item.unit,
      item.inQty,
      item.adjPlusQty,
      item.outQty,
      item.adjMinusQty,
      item.akhirQty,
      item.unit,
      item.minQty,
      item.maxQty,
      item.remark,
      item.movementStatus,
      item.price > 0 ? formatRupiah(item.price) : '',
      formatRupiah(item.totalValue),
      item.priceNote || '',
      item.status1th,
    ]);
  }

  // Totals Footer Row
  const totalAwal = items.reduce((sum, i) => sum + i.awalQty, 0);
  const totalIn = items.reduce((sum, i) => sum + i.inQty, 0);
  const totalAdjPlus = items.reduce((sum, i) => sum + i.adjPlusQty, 0);
  const totalOut = items.reduce((sum, i) => sum + i.outQty, 0);
  const totalAdjMinus = items.reduce((sum, i) => sum + i.adjMinusQty, 0);
  const totalAkhir = items.reduce((sum, i) => sum + i.akhirQty, 0);
  const totalAssetVal = items.reduce((sum, i) => sum + i.totalValue, 0);

  masterRows.push([]);
  masterRows.push([
    '',
    'TOTAL KESELURUHAN',
    '',
    '',
    '',
    '',
    `${items.length} SKU`,
    '',
    '',
    '',
    '',
    '',
    '',
    totalAwal,
    'Pcs',
    totalIn,
    totalAdjPlus,
    totalOut,
    totalAdjMinus,
    totalAkhir,
    'Pcs',
    '',
    '',
    '',
    '',
    '',
    formatRupiah(totalAssetVal),
    '',
    '',
  ]);

  const wsMaster = XLSX.utils.aoa_to_sheet(masterRows);
  wsMaster['!cols'] = [
    { wch: 6 },  // No
    { wch: 12 }, // Code Item
    { wch: 18 }, // Code Rak
    { wch: 8 },  // Type
    { wch: 18 }, // Model Unit
    { wch: 18 }, // Part Number
    { wch: 24 }, // Part Name
    { wch: 16 }, // CODE UNIT
    { wch: 12 }, // Tgl Update
    { wch: 12 }, // Tgl Masuk
    { wch: 12 }, // Tgl Keluar
    { wch: 22 }, // Supplier
    { wch: 20 }, // Brand
    { wch: 9 },  // Awal Qty
    { wch: 6 },  // Unit
    { wch: 9 },  // IN Qty
    { wch: 12 }, // (+) Qty
    { wch: 9 },  // OUT Qty
    { wch: 12 }, // (-) Qty
    { wch: 10 }, // Akhir Qty
    { wch: 6 },  // Unit
    { wch: 7 },  // MIN
    { wch: 7 },  // MAX
    { wch: 10 }, // REMARK
    { wch: 14 }, // Movement
    { wch: 15 }, // Price
    { wch: 16 }, // Total
    { wch: 15 }, // Note
    { wch: 14 }, // Status 1th
  ];
  XLSX.utils.book_append_sheet(wb, wsMaster, 'Master Stok Gudang');

  // Sheet 2: Riwayat Transaksi
  const txRows: (string | number)[][] = [
    [
      'ID Transaksi',
      'Tanggal',
      'Metode Input',
      'Jenis Transaksi',
      'Code Item',
      'Lokasi Rak',
      'Kategori',
      'Part Number',
      'Part Name',
      'Qty',
      'Stok Sebelum',
      'Stok Sesudah',
      'Nama Petugas / Mekanik',
      'Unit / Referensi WO',
      'Keterangan',
    ],
  ];

  for (const tx of transactions) {
    txRows.push([
      tx.id,
      tx.dateStr,
      tx.source === 'QR_SCANNER' ? 'QR Scanner' : 'Admin Web',
      tx.txType === 'IN'
        ? 'Barang Masuk (IN)'
        : tx.txType === 'OUT'
        ? 'Barang Keluar (OUT)'
        : tx.txType === 'ADJ_PLUS'
        ? 'Penyesuaian (+)'
        : 'Penyesuaian (-)',
      tx.codeItem,
      tx.rak,
      `${tx.typeCode} (${ITEM_TYPE_LABELS[tx.typeCode]?.desc || ''})`,
      tx.partNumber,
      tx.partName,
      tx.qty,
      tx.prevAkhirQty,
      tx.newAkhirQty,
      tx.picName,
      tx.unitRef,
      tx.notes,
    ]);
  }

  const wsTx = XLSX.utils.aoa_to_sheet(txRows);
  wsTx['!cols'] = [
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
    { wch: 12 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 24 },
    { wch: 8 },
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
    { wch: 22 },
    { wch: 34 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTx, 'Log Transaksi Harian');

  XLSX.writeFile(wb, `Master_Stok_Gudang_${formatLedgerDate()}.xlsx`);
}

/**
 * Exports Daily / Weekly / Monthly Warehouse Report to a multi-sheet .xlsx file.
 */
export function exportPeriodReportToExcel(params: {
  periodMode: 'HARIAN' | 'MINGGUAN' | 'BULANAN';
  periodLabel: string;
  summaryRows: PeriodSummaryItem[];
  periodTransactions: WarehouseTransaction[];
}) {
  const { periodMode, periodLabel, summaryRows, periodTransactions } = params;
  const wb = XLSX.utils.book_new();

  const totalTxCount = periodTransactions.length;
  const totalInQty = summaryRows.reduce((s, r) => s + r.periodIn, 0);
  const totalOutQty = summaryRows.reduce((s, r) => s + r.periodOut, 0);
  const totalAdjPlus = summaryRows.reduce((s, r) => s + r.periodAdjPlus, 0);
  const totalAdjMinus = summaryRows.reduce((s, r) => s + r.periodAdjMinus, 0);
  const totalInVal = summaryRows.reduce((s, r) => s + r.periodInValue, 0);
  const totalOutVal = summaryRows.reduce((s, r) => s + r.periodOutValue, 0);
  const totalCurrentAsset = summaryRows.reduce((s, r) => s + r.item.totalValue, 0);

  // Sheet 1: Ringkasan Eksekutif & Rekap Kategori
  const overviewAoA: (string | number)[][] = [
    [`LAPORAN ${periodMode} GUDANG - GUDANGPRO WMS`],
    [`Periode Laporan: ${periodLabel}`],
    [`Tanggal Cetak: ${formatLedgerDate()}`],
    [],
    ['RINGKASAN EKSEKUTIF PERIODE', 'NILAI / KUANTITAS'],
    ['Total Aktivitas Transaksi', `${totalTxCount} Transaksi`],
    ['Total Barang Masuk (IN)', `${totalInQty} Pcs`],
    ['Total Barang Keluar (OUT)', `${totalOutQty} Pcs`],
    ['Total Penyesuaian Tambah (+)', `${totalAdjPlus} Pcs`],
    ['Total Penyesuaian Kurang (-)', `${totalAdjMinus} Pcs`],
    ['Nilai Barang Masuk Periode Ini', formatRupiah(totalInVal)],
    ['Nilai Pengeluaran Barang Periode Ini', formatRupiah(totalOutVal)],
    ['Total Nilai Aset Gudang Saat Ini', formatRupiah(totalCurrentAsset)],
    [],
    [
      'REKAP PER KATEGORI (TYPE)',
      'Jumlah SKU',
      'Masuk (IN)',
      'Keluar (OUT)',
      'Stok Akhir Saat Ini',
      'Total Nilai Aset (Rp)',
    ],
  ];

  (['CNU', 'SPT', 'PS'] as const).forEach((typeCode) => {
    const group = summaryRows.filter((r) => r.item.typeCode === typeCode);
    overviewAoA.push([
      `${typeCode} - ${ITEM_TYPE_LABELS[typeCode].desc}`,
      group.length,
      group.reduce((s, r) => s + r.periodIn, 0),
      group.reduce((s, r) => s + r.periodOut, 0),
      group.reduce((s, r) => s + r.item.akhirQty, 0),
      formatRupiah(group.reduce((s, r) => s + r.item.totalValue, 0)),
    ]);
  });

  const wsOverview = XLSX.utils.aoa_to_sheet(overviewAoA);
  wsOverview['!cols'] = [
    { wch: 34 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
    { wch: 20 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsOverview, `Ringkasan ${periodMode}`);

  // Sheet 2: Rekap Mutasi Barang (SKU)
  const skuHeaders = [
    'No',
    'Code Item',
    'Code Rak',
    'Type',
    'Model Unit',
    'Part Number',
    'Part Name',
    'Supplier',
    'Brand',
    'Stok Awal Master',
    `Masuk ${periodMode} (IN)`,
    `Penyesuaian (+) ${periodMode}`,
    `Keluar ${periodMode} (OUT)`,
    `Penyesuaian (-) ${periodMode}`,
    'Frekuensi Transaksi',
    'Stok Akhir Saat Ini',
    'Unit',
    'MIN',
    'MAX',
    'REMARK',
    'Harga Satuan (Rp)',
    'Nilai Masuk Periode (Rp)',
    'Nilai Keluar Periode (Rp)',
    'Total Nilai Stok Akhir (Rp)',
  ];

  const skuRows: (string | number)[][] = [skuHeaders];
  for (const row of summaryRows) {
    const { item } = row;
    skuRows.push([
      item.no,
      item.codeItem,
      item.rak,
      item.typeCode,
      item.modelUnit,
      item.partNumber,
      item.partName,
      item.supplier,
      item.brand,
      item.awalQty,
      row.periodIn,
      row.periodAdjPlus,
      row.periodOut,
      row.periodAdjMinus,
      row.txCount,
      item.akhirQty,
      item.unit,
      item.minQty,
      item.maxQty,
      item.remark,
      item.price,
      row.periodInValue,
      row.periodOutValue,
      item.totalValue,
    ]);
  }

  const wsSku = XLSX.utils.aoa_to_sheet(skuRows);
  wsSku['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 16 },
    { wch: 8 },
    { wch: 18 },
    { wch: 18 },
    { wch: 24 },
    { wch: 20 },
    { wch: 18 },
    { wch: 15 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 7 },
    { wch: 7 },
    { wch: 7 },
    { wch: 10 },
    { wch: 16 },
    { wch: 20 },
    { wch: 20 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSku, 'Rekap Mutasi Barang');

  // Sheet 3: Detail Transaksi Periode
  const txRows: (string | number)[][] = [
    [
      'ID Transaksi',
      'Tanggal',
      'Metode',
      'Tipe Transaksi',
      'Code Item',
      'Code Rak',
      'Type',
      'Part Number',
      'Part Name',
      'Qty (Pcs)',
      'Stok Sebelum',
      'Stok Sesudah',
      'Petugas / Mekanik',
      'Unit / No. WO',
      'Catatan',
    ],
  ];

  for (const tx of periodTransactions) {
    txRows.push([
      tx.id,
      tx.dateStr,
      tx.source === 'QR_SCANNER' ? 'QR Scanner' : 'Manual Admin',
      tx.txType,
      tx.codeItem,
      tx.rak,
      tx.typeCode,
      tx.partNumber,
      tx.partName,
      tx.qty,
      tx.prevAkhirQty,
      tx.newAkhirQty,
      tx.picName,
      tx.unitRef,
      tx.notes,
    ]);
  }

  const wsTx = XLSX.utils.aoa_to_sheet(txRows);
  wsTx['!cols'] = [
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 16 },
    { wch: 8 },
    { wch: 18 },
    { wch: 24 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 22 },
    { wch: 20 },
    { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTx, 'Rincian Transaksi');

  const safeLabel = periodLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `Laporan_${periodMode}_Gudang_${safeLabel}.xlsx`);
}
