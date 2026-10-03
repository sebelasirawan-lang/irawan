import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Printer,
  FileSpreadsheet,
  Download,
  ArrowDownLeft,
  ArrowUpRight,
  Layers,
  Calendar,
  Building2,
  UserCheck,
  Boxes,
  CheckCircle2,
  FileText,
  Wrench,
  Truck,
  User,
} from 'lucide-react';
import {
  InventoryItem,
  WarehouseTransaction,
  formatDateDdMmmmYy,
  formatRupiah,
  formatLedgerDate,
  parseDateFromLedgerString,
  splitPicAndRecipient,
} from '../types/warehouse';

interface PrintReportPanelProps {
  items: InventoryItem[];
  transactions: WarehouseTransaction[];
  onUpdateTransaction?: (updatedTx: WarehouseTransaction) => Promise<void> | void;
}

export type ReportFlowFilter = 'ALL' | 'IN' | 'OUT';
export type ReportPeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type ReportContentSection = 'BOTH' | 'TRANSACTIONS_ONLY' | 'SUMMARY_ONLY';

function parseLedgerDateToDate(dateStr: string, fallbackMs?: number): Date {
  if (dateStr) {
    const parsed = parseDateFromLedgerString(
      dateStr,
      fallbackMs ? new Date(fallbackMs) : new Date()
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (fallbackMs) return new Date(fallbackMs);
  return new Date();
}

export const PrintReportPanel: React.FC<PrintReportPanelProps> = ({
  items,
  transactions,
  onUpdateTransaction,
}) => {
  // Report Filter States (Defaulting to MONTHLY so all recent transactions are immediately visible)
  const [flowFilter, setFlowFilter] = useState<ReportFlowFilter>('ALL');
  const [periodType, setPeriodType] = useState<ReportPeriodType>('MONTHLY');
  const [sectionMode, setSectionMode] = useState<ReportContentSection>('BOTH');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [recapPageSize, setRecapPageSize] = useState<number>(100);
  const [recapPage, setRecapPage] = useState<number>(1);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // Date selector states (Defaulting to latest transaction date or current date)
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (transactions.length > 0) {
      const latestDt = parseLedgerDateToDate(
        transactions[0].dateStr,
        transactions[0].timestampMs
      );
      if (!Number.isNaN(latestDt.getTime())) {
        const yyyy = latestDt.getFullYear();
        const mm = String(latestDt.getMonth() + 1).padStart(2, '0');
        const dd = String(latestDt.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    if (transactions.length > 0) {
      const latestDt = parseLedgerDateToDate(
        transactions[0].dateStr,
        transactions[0].timestampMs
      );
      if (!Number.isNaN(latestDt.getTime())) {
        const yyyy = latestDt.getFullYear();
        const mm = String(latestDt.getMonth() + 1).padStart(2, '0');
        return `${yyyy}-${mm}`;
      }
    }
    const now = new Date();
    return now.toISOString().slice(0, 7); // YYYY-MM
  });

  // Document Signatories & Customization
  const [companyName, setCompanyName] = useState<string>(
    'PT. Mega Multi Energi'
  );
  const [warehouseUnit, setWarehouseUnit] = useState<string>(
    'Gudang Logistik Sparepart & Consumable'
  );
  const [preparedBy, setPreparedBy] = useState<string>('Irawan');
  const [checkedBy, setCheckedBy] = useState<string>('Supervisor Logistik');
  const [approvedBy, setApprovedBy] = useState<string>('Kepala Gudang / Manager');

  // Map items by codeItem for lookup of Code Unit & Price
  const itemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    items.forEach((i) => map.set(i.codeItem.toUpperCase(), i));
    return map;
  }, [items]);

  // Helper to resolve Code Unit for a transaction
  const getTransactionCodeUnit = (tx: WarehouseTransaction): string => {
    const masterItem = itemMap.get(tx.codeItem.toUpperCase());
    if (tx.unitRef && tx.unitRef.trim() && tx.unitRef.trim() !== '-') {
      return tx.unitRef.trim();
    }
    if (masterItem) {
      return masterItem.codeUnit || masterItem.modelUnit || '-';
    }
    return '-';
  };

  // Map latest transaction per item for Recap Table display
  const latestTxByItem = useMemo(() => {
    const map = new Map<
      string,
      { mechanic: string; codeUnit: string; picLogistik: string }
    >();
    for (const tx of transactions) {
      const key = tx.codeItem.toUpperCase();
      if (!map.has(key)) {
        const { officer, recipient } = splitPicAndRecipient(tx);
        map.set(key, {
          mechanic: recipient && recipient !== '-' ? recipient : '-',
          codeUnit: getTransactionCodeUnit(tx),
          picLogistik: officer || 'Petugas Logistik',
        });
      }
    }
    return map;
  }, [transactions, itemMap]);

  // Filter Transactions by Flow (IN / OUT / ALL), Period (Daily / Weekly / Monthly), and Category
  const filteredTransactions = useMemo(() => {
    const refDate = new Date(selectedDate + 'T23:59:59');
    const startOfSelectedDay = new Date(selectedDate + 'T00:00:00');
    const sevenDaysAgo = new Date(refDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    return transactions.filter((tx) => {
      // 1. Flow filter
      if (flowFilter === 'IN' && tx.txType !== 'IN' && tx.txType !== 'ADJ_PLUS') {
        return false;
      }
      if (flowFilter === 'OUT' && tx.txType !== 'OUT' && tx.txType !== 'ADJ_MINUS') {
        return false;
      }

      // 2. Category filter
      if (categoryFilter !== 'ALL' && tx.typeCode !== categoryFilter) {
        return false;
      }

      // 3. Period filter
      const txDate = parseLedgerDateToDate(tx.dateStr, tx.timestampMs);

      if (periodType === 'DAILY') {
        const sameDay =
          txDate.getFullYear() === startOfSelectedDay.getFullYear() &&
          txDate.getMonth() === startOfSelectedDay.getMonth() &&
          txDate.getDate() === startOfSelectedDay.getDate();
        const sameFormatted =
          formatDateDdMmmmYy(tx.dateStr).toLowerCase() ===
          formatLedgerDate(startOfSelectedDay).toLowerCase();
        return sameDay || sameFormatted;
      }

      if (periodType === 'WEEKLY') {
        return txDate >= sevenDaysAgo && txDate <= refDate;
      }

      if (periodType === 'MONTHLY') {
        const [yStr, mStr] = selectedMonth.split('-');
        const targetYear = parseInt(yStr, 10);
        const targetMonth = parseInt(mStr, 10) - 1;
        return (
          txDate.getFullYear() === targetYear && txDate.getMonth() === targetMonth
        );
      }

      return true;
    });
  }, [transactions, flowFilter, periodType, selectedDate, selectedMonth, categoryFilter]);

  // Filter Master Items for the Recap Table
  const filteredRecapItems = useMemo(() => {
    return items.filter((item) => {
      if (categoryFilter !== 'ALL' && item.typeCode !== categoryFilter) {
        return false;
      }
      if (flowFilter === 'IN') {
        return item.inQty + item.adjPlusQty > 0;
      }
      if (flowFilter === 'OUT') {
        return item.outQty + item.adjMinusQty > 0;
      }
      return true;
    });
  }, [items, flowFilter, categoryFilter]);

  // Summary Statistics for the Print Header Cards
  const reportStats = useMemo(() => {
    let txInQty = 0;
    let txOutQty = 0;
    let txInValue = 0;
    let txOutValue = 0;

    filteredTransactions.forEach((tx) => {
      const price = itemMap.get(tx.codeItem.toUpperCase())?.price || 0;
      if (tx.txType === 'IN' || tx.txType === 'ADJ_PLUS') {
        txInQty += tx.qty;
        txInValue += tx.qty * price;
      } else {
        txOutQty += tx.qty;
        txOutValue += tx.qty * price;
      }
    });

    const recapTotalAwal = filteredRecapItems.reduce((s, i) => s + i.awalQty, 0);
    const recapTotalIn = filteredRecapItems.reduce(
      (s, i) => s + i.inQty + i.adjPlusQty,
      0
    );
    const recapTotalOut = filteredRecapItems.reduce(
      (s, i) => s + i.outQty + i.adjMinusQty,
      0
    );
    const recapTotalAkhir = filteredRecapItems.reduce((s, i) => s + i.akhirQty, 0);
    const recapTotalAsset = filteredRecapItems.reduce(
      (s, i) => s + i.totalValue,
      0
    );
    const recapInValue = filteredRecapItems.reduce(
      (s, i) => s + (i.inQty + i.adjPlusQty) * i.price,
      0
    );
    const recapOutValue = filteredRecapItems.reduce(
      (s, i) => s + (i.outQty + i.adjMinusQty) * i.price,
      0
    );

    const cnuCount = filteredRecapItems.filter((i) => i.typeCode === 'CNU').length;
    const sptCount = filteredRecapItems.filter((i) => i.typeCode === 'SPT').length;
    const psCount = filteredRecapItems.filter((i) => i.typeCode === 'PS').length;

    return {
      txCount: filteredTransactions.length,
      txInQty,
      txOutQty,
      txInValue,
      txOutValue,
      recapTotalAwal,
      recapTotalIn,
      recapTotalOut,
      recapTotalAkhir,
      recapTotalAsset,
      recapInValue,
      recapOutValue,
      cnuCount,
      sptCount,
      psCount,
    };
  }, [filteredTransactions, filteredRecapItems, itemMap]);

  // Human-readable Period Label
  const periodLabel = useMemo(() => {
    if (periodType === 'DAILY') {
      const d = new Date(selectedDate + 'T12:00:00');
      return `HARIAN • ${d.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`;
    }
    if (periodType === 'WEEKLY') {
      const end = new Date(selectedDate + 'T12:00:00');
      const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
      return `MINGGUAN (7 HARI) • ${start.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
      })} – ${end.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`;
    }
    const [y, m] = selectedMonth.split('-');
    const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    return `BULANAN • ${d.toLocaleDateString('id-ID', {
      month: 'long',
      year: 'numeric',
    })}`;
  }, [periodType, selectedDate, selectedMonth]);

  const reportTitle = useMemo(() => {
    if (flowFilter === 'IN') return 'LAPORAN BARANG MASUK (INBOUND)';
    if (flowFilter === 'OUT') return 'LAPORAN BARANG KELUAR (OUTBOUND)';
    return 'LAPORAN MUTASI BARANG MASUK & KELUAR';
  }, [flowFilter]);

  const docNumber = useMemo(() => {
    const flowCode = flowFilter === 'IN' ? 'IN' : flowFilter === 'OUT' ? 'OUT' : 'MUT';
    const perCode =
      periodType === 'DAILY' ? 'D' : periodType === 'WEEKLY' ? 'W' : 'M';
    return `RPT/MME/${flowCode}-${perCode}/${selectedDate.replace(/-/g, '')}`;
  }, [flowFilter, periodType, selectedDate]);

  // Inline update handler for Nama Mekanik Pengambil, Code Unit, and PIC Logistik per transaction
  const handleInlineTxFieldChange = (
    tx: WarehouseTransaction,
    field: 'mechanic' | 'codeUnit' | 'picLogistik',
    value: string
  ) => {
    if (!onUpdateTransaction) return;
    const { officer, recipient } = splitPicAndRecipient(tx);
    const nextOfficer = field === 'picLogistik' ? value : officer;
    const nextRecipient = field === 'mechanic' ? value : recipient;
    const nextCodeUnit = field === 'codeUnit' ? value : getTransactionCodeUnit(tx);

    onUpdateTransaction({
      ...tx,
      picName: nextOfficer,
      recipientName: nextRecipient,
      unitRef: nextCodeUnit,
    });
  };

  const handlePrintDocument = () => {
    const prevTitle = document.title;
    document.title = `Laporan_Gudang_${flowFilter}_${periodType}_${selectedDate}`;
    window.print();
    setTimeout(() => {
      document.title = prevTitle;
    }, 1000);
  };

  const handleExportReportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Rincian Log Transaksi (dengan Nama Mekanik Pengambil, Code Unit, dan PIC Logistik)
    const txHeaders = [
      'No',
      'Tanggal',
      'Tipe Transaksi',
      'Code Item',
      'Lokasi Rak',
      'Kategori',
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
    const txRows = filteredTransactions.map((tx, idx) => {
      const { officer, recipient } = splitPicAndRecipient(tx);
      const codeUnitVal = getTransactionCodeUnit(tx);
      return [
        idx + 1,
        formatDateDdMmmmYy(tx.dateStr),
        tx.txType,
        tx.codeItem,
        tx.rak,
        tx.typeCode,
        tx.partName,
        tx.partNumber,
        tx.qty,
        tx.prevAkhirQty,
        tx.newAkhirQty,
        recipient,
        codeUnitVal,
        officer,
        tx.notes,
      ];
    });

    const wsTx = XLSX.utils.aoa_to_sheet([
      [companyName],
      [`RINCIAN LOG TRANSAKSI - ${periodLabel}`],
      [`No. Dokumen: ${docNumber} | Author: Irawan`],
      [],
      txHeaders,
      ...txRows,
    ]);
    XLSX.utils.book_append_sheet(wb, wsTx, 'Log_Transaksi');

    // Sheet 2: Rekapitulasi Mutasi Barang
    const recapHeaders = [
      'No',
      'Code Item',
      'Code Rak',
      'Kategori',
      'Part Name',
      'Part Number',
      'Code Unit',
      'Model Unit',
      'Nama Mekanik Pengambil',
      'PIC Logistik',
      'Supplier',
      'Stok Awal',
      'Barang Masuk (IN)',
      'Penyesuaian (+)',
      'Barang Keluar (OUT)',
      'Penyesuaian (-)',
      'Stok Akhir',
      'Satuan',
      'Remark',
      'Harga Satuan (Rp)',
      'Nilai Barang Masuk (Rp)',
      'Nilai Barang Keluar (Rp)',
      'Total Nilai Stok Akhir (Rp)',
    ];

    const recapRows = filteredRecapItems.map((i) => {
      const latestMeta = latestTxByItem.get(i.codeItem.toUpperCase());
      return [
        i.no,
        i.codeItem,
        i.rak,
        i.typeCode,
        i.partName,
        i.partNumber,
        i.codeUnit || i.modelUnit,
        i.modelUnit,
        latestMeta?.mechanic || '-',
        latestMeta?.picLogistik || preparedBy,
        i.supplier,
        i.awalQty,
        i.inQty,
        i.adjPlusQty,
        i.outQty,
        i.adjMinusQty,
        i.akhirQty,
        i.unit,
        i.remark,
        i.price,
        (i.inQty + i.adjPlusQty) * i.price,
        (i.outQty + i.adjMinusQty) * i.price,
        i.totalValue,
      ];
    });

    const wsRecap = XLSX.utils.aoa_to_sheet([
      [companyName],
      [`${reportTitle} - ${periodLabel}`],
      [`No. Dokumen: ${docNumber} | Author: Irawan`],
      [],
      recapHeaders,
      ...recapRows,
    ]);
    XLSX.utils.book_append_sheet(wb, wsRecap, 'Rekap_Mutasi_Gudang');

    XLSX.writeFile(
      wb,
      `Laporan_Gudang_${flowFilter}_${periodType}_${selectedDate}.xlsx`
    );
  };

  // Generate and directly download authentic A4 Portrait PDF file
  const handleDownloadReportPdf = () => {
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
      const margin = 8;
      let currentY = 10;

      // 1. KOP SURAT / OFFICIAL LETTERHEAD
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(margin, currentY, pageWidth - margin * 2, 17, 'F');

      doc.setTextColor(245, 158, 11); // amber-400
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(companyName.toUpperCase(), margin + 4, currentY + 6);

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `${warehouseUnit} • ${reportTitle}`,
        margin + 4,
        currentY + 11
      );

      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(
        `No. Dokumen: ${docNumber} | Periode: ${periodLabel} | Dicetak: ${new Date().toLocaleDateString('id-ID')}`,
        margin + 4,
        currentY + 15
      );

      currentY += 21;

      // 2. EXECUTIVE METRIC SUMMARY BANNER
      doc.setFillColor(248, 250, 252); // slate-50
      doc.setDrawColor(203, 213, 225); // slate-300
      doc.rect(margin, currentY, pageWidth - margin * 2, 11, 'FD');

      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `Total SKU: ${filteredRecapItems.length} Item  |  Saldo Akhir: ${reportStats.recapTotalAkhir} Pcs  |  Masuk (+IN): +${reportStats.recapTotalIn} Pcs  |  Keluar (-OUT): -${reportStats.recapTotalOut} Pcs  |  Aset: ${formatRupiah(reportStats.recapTotalAsset)}`,
        margin + 3,
        currentY + 7
      );

      currentY += 15;

      // 3. TABEL A: RINCIAN LOG TRANSAKSI
      if (sectionMode === 'BOTH' || sectionMode === 'TRANSACTIONS_ONLY') {
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.text(
          `A. RINCIAN LOG TRANSAKSI HARIAN (${filteredTransactions.length} Transaksi)`,
          margin,
          currentY
        );
        currentY += 3;

        const txHeaders = [
          ['No', 'Tgl', 'Arus', 'Code & Rak', 'Nama Part & PN', 'Qty', 'Mekanik Pengambil', 'Code Unit', 'PIC Logistik']
        ];
        const txBody = filteredTransactions.map((tx, idx) => {
          const { officer, recipient } = splitPicAndRecipient(tx);
          const codeUnitVal = getTransactionCodeUnit(tx);
          const isIn = tx.txType === 'IN' || tx.txType === 'ADJ_PLUS';
          return [
            String(idx + 1),
            formatDateDdMmmmYy(tx.dateStr),
            isIn ? '+IN' : '-OUT',
            `${tx.codeItem}\nRak:${tx.rak}`,
            `${tx.partName}\nPN:${tx.partNumber}`,
            `${isIn ? '+' : '-'}${tx.qty}\n(${tx.prevAkhirQty}→${tx.newAkhirQty})`,
            recipient && recipient !== '-' ? recipient : '-',
            codeUnitVal || '-',
            officer && officer !== '-' ? officer : '-',
          ];
        });

        autoTable(doc, {
          startY: currentY,
          head: txHeaders,
          body: txBody,
          theme: 'grid',
          margin: { left: margin, right: margin },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontSize: 6.5,
            fontStyle: 'bold',
            halign: 'center',
          },
          styles: {
            fontSize: 6,
            cellPadding: 1.2,
            overflow: 'linebreak',
          },
          columnStyles: {
            0: { cellWidth: 7, halign: 'center' },
            1: { cellWidth: 16 },
            2: { cellWidth: 10, halign: 'center' },
            3: { cellWidth: 22 },
            4: { cellWidth: 'auto' },
            5: { cellWidth: 16, halign: 'right' },
            6: { cellWidth: 22 },
            7: { cellWidth: 20 },
            8: { cellWidth: 20 },
          },
          didDrawPage: () => {
            doc.setFontSize(6);
            doc.setTextColor(148, 163, 184);
            doc.text(
              `${companyName} • Laporan Gudang Resmi • Halaman ${doc.getNumberOfPages()}`,
              margin,
              doc.internal.pageSize.getHeight() - 4
            );
          },
        });

        // @ts-expect-error jspdf-autotable extends jsPDF instance with lastAutoTable
        currentY = (doc.lastAutoTable?.finalY || currentY) + 7;
      }

      // 4. TABEL B: REKAPITULASI MUTASI BARANG GUDANG
      if (sectionMode === 'BOTH' || sectionMode === 'SUMMARY_ONLY') {
        if (currentY > doc.internal.pageSize.getHeight() - 40) {
          doc.addPage();
          currentY = 12;
        }

        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.text(
          `${sectionMode === 'BOTH' ? 'B.' : 'A.'} REKAPITULASI MUTASI BARANG GUDANG (${filteredRecapItems.length} Item)`,
          margin,
          currentY
        );
        currentY += 3;

        const recapHeaders = [
          ['No', 'Code & Rak', 'Nama Part & PN', 'Code Unit', 'Mekanik & PIC', 'Awal', 'IN', 'OUT', 'Akhir', 'Harga Satuan', 'Total Nilai']
        ];
        const recapBody = filteredRecapItems.map((item, idx) => {
          const itemInTotal = item.inQty + item.adjPlusQty;
          const itemOutTotal = item.outQty + item.adjMinusQty;
          const latestMeta = latestTxByItem.get(item.codeItem.toUpperCase());
          return [
            String(idx + 1),
            `${item.codeItem}\nRak:${item.rak}`,
            `${item.partName}\nPN:${item.partNumber}`,
            latestMeta?.codeUnit || item.codeUnit || item.modelUnit || '-',
            `Mek: ${latestMeta?.mechanic || '-'}\nPIC: ${latestMeta?.picLogistik || preparedBy}`,
            String(item.awalQty),
            `+${itemInTotal}`,
            `-${itemOutTotal}`,
            `${item.akhirQty} ${item.unit}`,
            item.price > 0 ? formatRupiah(item.price) : 'Rp0',
            formatRupiah(item.totalValue),
          ];
        });

        const recapFoot = [
          [
            'TOTAL REKAPITULASI',
            '',
            '',
            '',
            '',
            String(reportStats.recapTotalAwal),
            `+${reportStats.recapTotalIn}`,
            `-${reportStats.recapTotalOut}`,
            `${reportStats.recapTotalAkhir} Pcs`,
            '',
            formatRupiah(reportStats.recapTotalAsset),
          ]
        ];

        autoTable(doc, {
          startY: currentY,
          head: recapHeaders,
          body: recapBody,
          foot: recapFoot,
          theme: 'grid',
          margin: { left: margin, right: margin },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontSize: 6.5,
            fontStyle: 'bold',
            halign: 'center',
          },
          footStyles: {
            fillColor: [15, 23, 42],
            textColor: [245, 158, 11],
            fontSize: 6.5,
            fontStyle: 'bold',
          },
          styles: {
            fontSize: 6,
            cellPadding: 1.2,
            overflow: 'linebreak',
          },
          columnStyles: {
            0: { cellWidth: 7, halign: 'center' },
            1: { cellWidth: 19 },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 16 },
            4: { cellWidth: 22 },
            5: { cellWidth: 10, halign: 'right' },
            6: { cellWidth: 11, halign: 'right' },
            7: { cellWidth: 11, halign: 'right' },
            8: { cellWidth: 15, halign: 'right' },
            9: { cellWidth: 20, halign: 'right' },
            10: { cellWidth: 23, halign: 'right' },
          },
          didDrawPage: () => {
            doc.setFontSize(6);
            doc.setTextColor(148, 163, 184);
            doc.text(
              `${companyName} • Laporan Gudang Resmi • Halaman ${doc.getNumberOfPages()}`,
              margin,
              doc.internal.pageSize.getHeight() - 4
            );
          },
        });

        // @ts-expect-error jspdf-autotable extends jsPDF instance with lastAutoTable
        currentY = (doc.lastAutoTable?.finalY || currentY) + 7;
      }

      // 5. BLOK TANDA TANGAN / PENGESAHAN DOKUMEN
      if (currentY > doc.internal.pageSize.getHeight() - 30) {
        doc.addPage();
        currentY = 15;
      }

      doc.setDrawColor(203, 213, 225); // slate-300
      doc.line(margin, currentY, pageWidth - margin, currentY);
      currentY += 4;

      const colWidth = (pageWidth - margin * 2) / 3;

      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'bold');
      doc.text('Dibuat Oleh,', margin + colWidth * 0.5, currentY, { align: 'center' });
      doc.text('Diperiksa Oleh (PIC Logistik),', margin + colWidth * 1.5, currentY, { align: 'center' });
      doc.text('Disetujui Oleh,', margin + colWidth * 2.5, currentY, { align: 'center' });

      currentY += 13;

      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(preparedBy, margin + colWidth * 0.5, currentY, { align: 'center' });
      doc.text(checkedBy, margin + colWidth * 1.5, currentY, { align: 'center' });
      doc.text(approvedBy, margin + colWidth * 2.5, currentY, { align: 'center' });

      currentY += 3.5;
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Admin Inventaris Gudang', margin + colWidth * 0.5, currentY, { align: 'center' });
      doc.text('PIC Logistik & Operasional', margin + colWidth * 1.5, currentY, { align: 'center' });
      doc.text('Kepala Gudang / Pimpinan', margin + colWidth * 2.5, currentY, { align: 'center' });

      // Save PDF directly to user's device
      const fileName = `Laporan_Gudang_${flowFilter}_${periodType}_${selectedDate}.pdf`;
      doc.save(fileName);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
        }
      `}</style>

      {/* =====================================================================
          INTERACTIVE FILTER & CONFIGURATION PANEL (HIDDEN ON PRINT)
         ===================================================================== */}
      <div className="no-print bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">
                  Pusat Cetak Laporan Barang Masuk & Keluar Gudang
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-amber-300 font-mono text-[10px] font-bold uppercase">
                  A4 Portrait (Tegak)
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Format cetak <strong>A4 Portrait</strong> dilengkapi kolom <strong>Nama Mekanik Pengambil</strong>, <strong>Code Unit</strong>, dan <strong>PIC Logistik</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Tombol Unduh Laporan PDF (Utama) */}
            <button
              type="button"
              disabled={isGeneratingPdf}
              onClick={handleDownloadReportPdf}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 font-bold text-xs transition cursor-pointer disabled:opacity-50 shadow-sm"
              title="Unduh Laporan langsung ke format PDF (.pdf)"
            >
              <Download className="w-4 h-4 text-rose-400" />
              <span>{isGeneratingPdf ? 'Membuat PDF...' : 'Unduh Laporan (PDF)'}</span>
            </button>

            {/* 2. Tombol Download Laporan Excel */}
            <button
              type="button"
              onClick={handleExportReportExcel}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/40 text-blue-300 font-bold text-xs transition cursor-pointer"
              title="Download Laporan lengkap dalam format Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-4 h-4 text-blue-400" />
              Download Excel (.xlsx)
            </button>

            {/* 3. Tombol Cetak Dokumen / Simpan PDF Browser */}
            <button
              type="button"
              onClick={handlePrintDocument}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition cursor-pointer shadow-lg shadow-amber-500/20"
              title="Cetak Laporan ke printer atau simpan sebagai file PDF"
            >
              <Printer className="w-4 h-4" />
              Cetak / Simpan PDF
            </button>
          </div>
        </div>

        {/* Row 1: Pilihan Jenis Arus (Masuk / Keluar / Semua) & Periode (Harian / Mingguan / Bulanan) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Pilihan Jenis Laporan: Masuk / Keluar */}
          <div className="lg:col-span-5 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              1. Pilih Jenis Laporan (Arus Barang)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFlowFilter('ALL')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  flowFilter === 'ALL'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-200 shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Layers className="w-4 h-4 text-amber-400 mb-1" />
                <div className="text-xs font-bold text-slate-100">Semua Mutasi</div>
                <div className="text-[10px] text-slate-400">Masuk & Keluar</div>
              </button>

              <button
                type="button"
                onClick={() => setFlowFilter('IN')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  flowFilter === 'IN'
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-200 shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <ArrowDownLeft className="w-4 h-4 text-emerald-400 mb-1" />
                <div className="text-xs font-bold text-slate-100">Barang Masuk</div>
                <div className="text-[10px] text-emerald-400/80">Khusus Inbound (+IN)</div>
              </button>

              <button
                type="button"
                onClick={() => setFlowFilter('OUT')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  flowFilter === 'OUT'
                    ? 'bg-rose-500/15 border-rose-500 text-rose-200 shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <ArrowUpRight className="w-4 h-4 text-rose-400 mb-1" />
                <div className="text-xs font-bold text-slate-100">Barang Keluar</div>
                <div className="text-[10px] text-rose-400/80">Khusus Outbound (-OUT)</div>
              </button>
            </div>
          </div>

          {/* Pilihan Periode: Harian / Mingguan / Bulanan */}
          <div className="lg:col-span-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              2. Pilih Periode Laporan
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPeriodType('DAILY')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  periodType === 'DAILY'
                    ? 'bg-blue-500/15 border-blue-500 text-blue-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Calendar className="w-4 h-4 text-blue-400 mb-1" />
                <div className="text-xs font-bold text-slate-100">Harian</div>
                <div className="text-[10px] text-slate-400">Per Tanggal</div>
              </button>

              <button
                type="button"
                onClick={() => setPeriodType('WEEKLY')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  periodType === 'WEEKLY'
                    ? 'bg-blue-500/15 border-blue-500 text-blue-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Calendar className="w-4 h-4 text-blue-400 mb-1" />
                <div className="text-xs font-bold text-slate-100">Mingguan</div>
                <div className="text-[10px] text-slate-400">Rentang 7 Hari</div>
              </button>

              <button
                type="button"
                onClick={() => setPeriodType('MONTHLY')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  periodType === 'MONTHLY'
                    ? 'bg-blue-500/15 border-blue-500 text-blue-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Calendar className="w-4 h-4 text-blue-400 mb-1" />
                <div className="text-xs font-bold text-slate-100">Bulanan</div>
                <div className="text-[10px] text-slate-400">Rekap 1 Bulan</div>
              </button>
            </div>
          </div>

          {/* Pemilih Tanggal / Bulan & Kategori */}
          <div className="lg:col-span-3 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              3. Filter Waktu & Kategori
            </label>
            <div className="space-y-2">
              {periodType === 'MONTHLY' ? (
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 outline-none"
                />
              ) : (
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 outline-none"
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="ALL">Semua Kategori</option>
                  <option value="CNU">CNU - Consumable</option>
                  <option value="SPT">SPT - Spare Part</option>
                  <option value="PS">PS - Part Service</option>
                </select>
                <select
                  value={sectionMode}
                  onChange={(e) =>
                    setSectionMode(e.target.value as ReportContentSection)
                  }
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="BOTH">Log + Rekap Stok</option>
                  <option value="TRANSACTIONS_ONLY">Hanya Log Transaksi</option>
                  <option value="SUMMARY_ONLY">Hanya Rekap Stok</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Pengaturan Kop & Penandatangan Laporan */}
        <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
              Nama Perusahaan / Instansi
            </label>
            <div className="relative">
              <Building2 className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
              Unit / Lokasi Gudang
            </label>
            <input
              type="text"
              value={warehouseUnit}
              onChange={(e) => setWarehouseUnit(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
              Dibuat Oleh (Admin)
            </label>
            <div className="relative">
              <UserCheck className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
              Diperiksa Oleh (Logistik)
            </label>
            <input
              type="text"
              value={checkedBy}
              onChange={(e) => setCheckedBy(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
              Disetujui Oleh (Kepala Gudang)
            </label>
            <input
              type="text"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
            />
          </div>
        </div>
      </div>

      {/* =====================================================================
          PRINTABLE EXECUTIVE WAREHOUSE REPORT SHEET (A4 PORTRAIT)
          Designed for A4 Portrait paper (210mm width) both on screen & print
         ===================================================================== */}
      <div className="bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 p-5 sm:p-8 print:shadow-none print:border-none print:p-0 print:rounded-none max-w-[210mm] print:max-w-none print:w-full mx-auto">
        {/* 1. OFFICIAL LETTERHEAD / KOP SURAT LAPORAN (PORTRAIT OPTIMIZED) */}
        <div className="border-b-4 border-slate-900 pb-4 mb-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center shrink-0 font-extrabold shadow-sm print:border print:border-slate-900">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-900 text-amber-400">
                  PT. MEGA MULTI ENERGI
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  {docNumber}
                </span>
                <span className="text-[10px] font-mono font-semibold text-slate-600">
                  • Author: Irawan
                </span>
              </div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 mt-0.5">
                {companyName}
              </h1>
              <p className="text-[11px] font-medium text-slate-600">
                {warehouseUnit} • Sistem Inventaris & Scanner QR Real-Time
              </p>
            </div>
          </div>

          <div className="sm:text-right space-y-0.5 shrink-0">
            <div
              className={`inline-block px-2.5 py-0.5 rounded-md font-mono text-[10px] font-extrabold uppercase tracking-wider border ${
                flowFilter === 'IN'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : flowFilter === 'OUT'
                  ? 'bg-rose-50 text-rose-800 border-rose-300'
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}
            >
              {reportTitle}
            </div>
            <div className="text-[10px] font-bold text-slate-800 font-mono">
              PERIODE: {periodLabel}
            </div>
            <div className="text-[9px] text-slate-500 font-mono">
              Dicetak: {new Date().toLocaleString('id-ID')}
            </div>
          </div>
        </div>

        {/* 2. EXECUTIVE SUMMARY CARDS (4 METRIC BOXES - COMPACT FOR PORTRAIT) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          {/* Box 1: Total SKU & Stok Akhir */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
              Total Item Tercatat
            </span>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-lg font-extrabold font-mono text-slate-900">
                {filteredRecapItems.length.toLocaleString('id-ID')}
              </span>
              <span className="text-[10px] font-semibold text-slate-600">SKU</span>
            </div>
            <div className="mt-0.5 text-[10px] font-mono text-slate-600">
              Saldo: <strong>{reportStats.recapTotalAkhir.toLocaleString('id-ID')} Pcs</strong>
            </div>
          </div>

          {/* Box 2: Total Barang Masuk (IN) */}
          <div
            className={`rounded-xl border p-2.5 ${
              flowFilter === 'IN'
                ? 'border-emerald-400 bg-emerald-50/70 ring-1 ring-emerald-400'
                : 'border-slate-200 bg-emerald-50/30'
            }`}
          >
            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 block">
              Barang Masuk (+IN)
            </span>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-lg font-extrabold font-mono text-emerald-700">
                +{reportStats.recapTotalIn.toLocaleString('id-ID')}
              </span>
              <span className="text-[10px] font-semibold text-emerald-700">Pcs</span>
            </div>
            <div className="mt-0.5 text-[10px] font-mono text-emerald-800 truncate">
              <strong>{formatRupiah(reportStats.recapInValue)}</strong>
            </div>
          </div>

          {/* Box 3: Total Barang Keluar (OUT) */}
          <div
            className={`rounded-xl border p-2.5 ${
              flowFilter === 'OUT'
                ? 'border-rose-400 bg-rose-50/70 ring-1 ring-rose-400'
                : 'border-slate-200 bg-rose-50/30'
            }`}
          >
            <span className="text-[9px] font-bold uppercase tracking-wider text-rose-700 block">
              Barang Keluar (-OUT)
            </span>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-lg font-extrabold font-mono text-rose-700">
                -{reportStats.recapTotalOut.toLocaleString('id-ID')}
              </span>
              <span className="text-[10px] font-semibold text-rose-700">Pcs</span>
            </div>
            <div className="mt-0.5 text-[10px] font-mono text-rose-800 truncate">
              <strong>{formatRupiah(reportStats.recapOutValue)}</strong>
            </div>
          </div>

          {/* Box 4: Nilai Persediaan Akhir */}
          <div className="rounded-xl border border-slate-200 bg-amber-50/40 p-2.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-800 block">
              Nilai Aset Persediaan
            </span>
            <div className="mt-0.5 truncate">
              <span className="text-sm font-extrabold font-mono text-slate-900">
                {formatRupiah(reportStats.recapTotalAsset)}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] font-mono text-slate-600">
              Log: <strong>{reportStats.txCount} Transaksi</strong>
            </div>
          </div>
        </div>

        {/* Visual Proportion Bar (Inbound vs Outbound Ratio) */}
        <div className="mb-5 p-2.5 rounded-xl border border-slate-200 bg-slate-50">
          <div className="flex flex-wrap items-center justify-between text-[10px] font-bold text-slate-700 mb-1.5">
            <span>
              Perbandingan Volume Pergerakan Barang (Masuk vs Keluar)
            </span>
            <span className="font-mono text-[10px]">
              IN: {reportStats.recapTotalIn} Pcs ({Math.round((reportStats.recapTotalIn / Math.max(1, reportStats.recapTotalIn + reportStats.recapTotalOut)) * 100)}%) • OUT: {reportStats.recapTotalOut} Pcs ({Math.round((reportStats.recapTotalOut / Math.max(1, reportStats.recapTotalIn + reportStats.recapTotalOut)) * 100)}%)
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden flex">
            <div
              style={{
                width: `${
                  (reportStats.recapTotalIn /
                    Math.max(1, reportStats.recapTotalIn + reportStats.recapTotalOut)) *
                  100
                }%`,
              }}
              className="bg-emerald-600 h-full"
            />
            <div
              style={{
                width: `${
                  (reportStats.recapTotalOut /
                    Math.max(1, reportStats.recapTotalIn + reportStats.recapTotalOut)) *
                  100
                }%`,
              }}
              className="bg-rose-600 h-full"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between text-[9px] text-slate-500 mt-1 font-mono">
            <span>
              Kategori: CNU ({reportStats.cnuCount}) • SPT ({reportStats.sptCount}) • PS ({reportStats.psCount})
            </span>
            <span>
              Status: ORDER ({filteredRecapItems.filter((i) => i.remark === 'ORDER').length}) • AMAN ({filteredRecapItems.filter((i) => i.remark === 'AMAN').length}) • OVER ({filteredRecapItems.filter((i) => i.remark === 'OVER').length})
            </span>
          </div>
        </div>

        {/* 3. SECTION A: LOG TRANSAKSI PERIODE (PORTRAIT TABLE WITH MEKANIK, CODE UNIT, & PIC LOGISTIK) */}
        {(sectionMode === 'BOTH' || sectionMode === 'TRANSACTIONS_ONLY') && (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-700" />
                  A. Rincian Log Transaksi{' '}
                  {flowFilter === 'IN'
                    ? 'Barang Masuk (Inbound)'
                    : flowFilter === 'OUT'
                    ? 'Barang Keluar (Outbound)'
                    : 'Barang Masuk & Keluar'}{' '}
                  ({periodType === 'DAILY' ? 'Harian' : periodType === 'WEEKLY' ? 'Mingguan' : 'Bulanan'})
                </h3>
                <p className="no-print text-[11px] text-slate-500 mt-0.5">
                  Anda dapat langsung mengisi/mengubah <strong>Nama Mekanik Pengambil</strong>, <strong>Code Unit</strong>, dan <strong>PIC Logistik</strong> pada setiap baris transaksi.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-semibold text-slate-600">
                  Total: {filteredTransactions.length} Transaksi
                </span>
                {filteredTransactions.length > 0 && (
                  <button
                    type="button"
                    disabled={isGeneratingPdf}
                    onClick={handleDownloadReportPdf}
                    className="no-print inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 text-[11px] font-bold transition cursor-pointer"
                    title="Unduh Rincian Log Transaksi ke file PDF"
                  >
                    <Download className="w-3.5 h-3.5 text-rose-700" />
                    Unduh PDF
                  </button>
                )}
              </div>
            </div>

            {filteredTransactions.length === 0 ? (
              <div className="border border-slate-200 rounded-xl p-5 text-center text-xs text-slate-500 bg-slate-50 space-y-2">
                <p>
                  Tidak ada aktivitas transaksi pada filter tanggal/periode ini.
                </p>
                {transactions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPeriodType('MONTHLY')}
                    className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-amber-400 font-bold text-xs cursor-pointer"
                  >
                    Tampilkan Semua Transaksi Bulan Ini ({transactions.length} Transaksi)
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto print:overflow-visible border border-slate-300 rounded-lg">
                <table className="w-full text-left border-collapse text-[10px] print:text-[8.5px] leading-tight">
                  <thead>
                    <tr className="bg-slate-900 text-white text-[9px] print:text-[8px] font-bold uppercase tracking-tight">
                      <th className="py-2 px-1.5 text-center border-r border-slate-700 w-6">No</th>
                      <th className="py-2 px-1.5 border-r border-slate-700 w-20">Tgl & Arus</th>
                      <th className="py-2 px-1.5 border-r border-slate-700 w-20">Code & Rak</th>
                      <th className="py-2 px-2 border-r border-slate-700">Nama Barang & PN</th>
                      <th className="py-2 px-1.5 text-right border-r border-slate-700 w-14">Qty / Saldo</th>
                      <th className="py-2 px-1.5 bg-amber-950/60 text-amber-200 border-r border-slate-700 w-28">
                        Mekanik Pengambil
                      </th>
                      <th className="py-2 px-1.5 bg-cyan-950/60 text-cyan-200 border-r border-slate-700 w-24">
                        Code Unit
                      </th>
                      <th className="py-2 px-1.5 bg-emerald-950/60 text-emerald-200 border-r border-slate-700 w-24">
                        PIC Logistik
                      </th>
                      <th className="py-2 px-1.5 w-24">Ket.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredTransactions.map((tx, idx) => {
                      const isIn = tx.txType === 'IN' || tx.txType === 'ADJ_PLUS';
                      const { officer, recipient } = splitPicAndRecipient(tx);
                      const resolvedCodeUnit = getTransactionCodeUnit(tx);

                      return (
                        <tr key={tx.id} className="even:bg-slate-50/80 align-top">
                          <td className="py-1.5 px-1 text-center font-mono text-slate-500 border-r border-slate-200">
                            {idx + 1}
                          </td>
                          <td className="py-1.5 px-1.5 font-mono border-r border-slate-200">
                            <div className="font-semibold text-slate-800 whitespace-nowrap">
                              {formatDateDdMmmmYy(tx.dateStr)}
                            </div>
                            <span
                              className={`inline-block mt-0.5 px-1 py-0.2 rounded font-mono text-[8px] font-extrabold ${
                                isIn
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-rose-100 text-rose-800 border border-rose-300'
                              }`}
                            >
                              {tx.txType === 'IN'
                                ? 'MASUK'
                                : tx.txType === 'OUT'
                                ? 'KELUAR'
                                : tx.txType === 'ADJ_PLUS'
                                ? 'ADJ (+)'
                                : 'ADJ (-)'}
                            </span>
                          </td>
                          <td className="py-1.5 px-1.5 font-mono border-r border-slate-200">
                            <div className="font-bold text-slate-900">{tx.codeItem}</div>
                            <div className="text-[9px] print:text-[7.5px] text-slate-500">
                              Rak: {tx.rak}
                            </div>
                          </td>
                          <td className="py-1.5 px-2 border-r border-slate-200">
                            <div className="font-bold text-slate-900 break-words">
                              {tx.partName}
                            </div>
                            <div className="font-mono text-[9px] print:text-[7.5px] text-slate-500 break-all">
                              PN: {tx.partNumber} ({tx.typeCode})
                            </div>
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono border-r border-slate-200 whitespace-nowrap">
                            <div
                              className={`font-extrabold ${
                                isIn ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {isIn ? '+' : '-'}
                              {tx.qty} Pcs
                            </div>
                            <div className="text-[9px] print:text-[7.5px] text-slate-500">
                              {tx.prevAkhirQty}→<strong>{tx.newAkhirQty}</strong>
                            </div>
                          </td>

                          {/* 1. NAMA MEKANIK PENGAMBIL */}
                          <td className="py-1.5 px-1.5 border-r border-slate-200 bg-amber-50/30">
                            {onUpdateTransaction ? (
                              <>
                                <div className="no-print flex items-center gap-1">
                                  <Wrench className="w-3 h-3 text-amber-600 shrink-0" />
                                  <input
                                    type="text"
                                    value={recipient === '-' ? '' : recipient}
                                    placeholder="Mekanik..."
                                    onChange={(e) =>
                                      handleInlineTxFieldChange(
                                        tx,
                                        'mechanic',
                                        e.target.value
                                      )
                                    }
                                    className="w-full min-w-[90px] bg-white border border-slate-300 focus:border-amber-600 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-900 outline-none"
                                  />
                                </div>
                                <div className="hidden print:block font-bold text-slate-900 break-words">
                                  {recipient}
                                </div>
                              </>
                            ) : (
                              <div className="font-bold text-slate-900 break-words">{recipient}</div>
                            )}
                          </td>

                          {/* 2. CODE UNIT */}
                          <td className="py-1.5 px-1.5 border-r border-slate-200 bg-cyan-50/30">
                            {onUpdateTransaction ? (
                              <>
                                <div className="no-print flex items-center gap-1">
                                  <Truck className="w-3 h-3 text-cyan-700 shrink-0" />
                                  <input
                                    type="text"
                                    value={resolvedCodeUnit === '-' ? '' : resolvedCodeUnit}
                                    placeholder="Code unit..."
                                    onChange={(e) =>
                                      handleInlineTxFieldChange(
                                        tx,
                                        'codeUnit',
                                        e.target.value
                                      )
                                    }
                                    className="w-full min-w-[80px] bg-white border border-slate-300 focus:border-cyan-600 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-900 outline-none"
                                  />
                                </div>
                                <div className="hidden print:block font-mono font-bold text-slate-900 break-words">
                                  {resolvedCodeUnit}
                                </div>
                              </>
                            ) : (
                              <div className="font-mono font-bold text-slate-900 break-words">
                                {resolvedCodeUnit}
                              </div>
                            )}
                          </td>

                          {/* 3. PIC LOGISTIK */}
                          <td className="py-1.5 px-1.5 border-r border-slate-200 bg-emerald-50/30">
                            {onUpdateTransaction ? (
                              <>
                                <div className="no-print flex items-center gap-1">
                                  <User className="w-3 h-3 text-emerald-700 shrink-0" />
                                  <input
                                    type="text"
                                    value={officer}
                                    placeholder="PIC Logistik..."
                                    onChange={(e) =>
                                      handleInlineTxFieldChange(
                                        tx,
                                        'picLogistik',
                                        e.target.value
                                      )
                                    }
                                    className="w-full min-w-[85px] bg-white border border-slate-300 focus:border-emerald-600 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-900 outline-none"
                                  />
                                </div>
                                <div className="hidden print:block font-semibold text-slate-900 break-words">
                                  {officer}
                                </div>
                              </>
                            ) : (
                              <div className="font-semibold text-slate-900 break-words">{officer}</div>
                            )}
                          </td>

                          <td className="py-1.5 px-1.5 text-slate-700 break-words">{tx.notes}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 4. SECTION B: REKAPITULASI MUTASI & SALDO BARANG GUDANG (PORTRAIT TABLE) */}
        {(sectionMode === 'BOTH' || sectionMode === 'SUMMARY_ONLY') && (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-slate-700" />
                {sectionMode === 'BOTH' ? 'B.' : 'A.'} Tabel Rekapitulasi Mutasi{' '}
                {flowFilter === 'IN'
                  ? 'Barang Masuk (IN)'
                  : flowFilter === 'OUT'
                  ? 'Barang Keluar (OUT)'
                  : 'Stok Masuk & Keluar Gudang'}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono font-semibold text-slate-600">
                  Total: {filteredRecapItems.length.toLocaleString('id-ID')} Item Gudang
                </span>
                <button
                  type="button"
                  disabled={isGeneratingPdf}
                  onClick={handleDownloadReportPdf}
                  className="no-print inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 text-[11px] font-bold transition cursor-pointer"
                  title="Unduh Rekapitulasi Mutasi ke file PDF"
                >
                  <Download className="w-3.5 h-3.5 text-rose-700" />
                  Unduh PDF
                </button>
                <div className="no-print flex items-center gap-1.5 text-xs">
                  <select
                    value={recapPageSize}
                    onChange={(e) => {
                      setRecapPageSize(Number(e.target.value));
                      setRecapPage(1);
                    }}
                    className="border border-slate-300 rounded px-2 py-0.5 text-[11px] font-mono text-slate-800 bg-white"
                  >
                    <option value={100}>100 Baris / Hal</option>
                    <option value={250}>250 Baris / Hal</option>
                    <option value={500}>500 Baris / Hal</option>
                    <option value={3500}>Semua ({filteredRecapItems.length})</option>
                  </select>
                  {filteredRecapItems.length > recapPageSize && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={recapPage <= 1}
                        onClick={() => setRecapPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-0.5 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[11px] font-bold text-slate-800 cursor-pointer"
                      >
                        ‹
                      </button>
                      <span className="font-mono text-[11px] text-slate-700">
                        {recapPage}/{Math.max(1, Math.ceil(filteredRecapItems.length / recapPageSize))}
                      </span>
                      <button
                        type="button"
                        disabled={
                          recapPage >=
                          Math.max(1, Math.ceil(filteredRecapItems.length / recapPageSize))
                        }
                        onClick={() =>
                          setRecapPage((p) =>
                            Math.min(
                              Math.max(1, Math.ceil(filteredRecapItems.length / recapPageSize)),
                              p + 1
                            )
                          )
                        }
                        className="px-2 py-0.5 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[11px] font-bold text-slate-800 cursor-pointer"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto print:overflow-visible border border-slate-300 rounded-lg">
              <table className="w-full text-left border-collapse text-[10px] print:text-[8.5px] leading-tight">
                <thead>
                  <tr className="bg-slate-900 text-white text-[9px] print:text-[8px] font-bold uppercase tracking-tight">
                    <th className="py-2 px-1 text-center border-r border-slate-700 w-6">No</th>
                    <th className="py-2 px-1.5 border-r border-slate-700 w-20">Code & Rak</th>
                    <th className="py-2 px-2 border-r border-slate-700">Part Name & PN</th>
                    <th className="py-2 px-1.5 bg-cyan-950/60 text-cyan-200 border-r border-slate-700 w-24">
                      Unit / Model
                    </th>
                    <th className="py-2 px-1.5 bg-amber-950/60 text-amber-200 border-r border-slate-700 w-28">
                      Mekanik & PIC
                    </th>
                    <th className="py-2 px-1 text-right border-r border-slate-700 w-9">Awal</th>
                    {flowFilter !== 'OUT' && (
                      <th className="py-2 px-1 text-right bg-emerald-900 text-emerald-200 border-r border-slate-700 w-10">
                        IN
                      </th>
                    )}
                    {flowFilter !== 'IN' && (
                      <th className="py-2 px-1 text-right bg-rose-900 text-rose-200 border-r border-slate-700 w-10">
                        OUT
                      </th>
                    )}
                    <th className="py-2 px-1.5 text-right border-r border-slate-700 w-14">Akhir</th>
                    <th className="py-2 px-1.5 text-right border-r border-slate-700 w-20">Harga</th>
                    <th className="py-2 px-1.5 text-right w-24">
                      {flowFilter === 'IN'
                        ? 'Nilai IN'
                        : flowFilter === 'OUT'
                        ? 'Nilai OUT'
                        : 'Total Nilai'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRecapItems
                    .slice((recapPage - 1) * recapPageSize, recapPage * recapPageSize)
                    .map((item, idx) => {
                      const rowNum = (recapPage - 1) * recapPageSize + idx + 1;
                      const itemInTotal = item.inQty + item.adjPlusQty;
                      const itemOutTotal = item.outQty + item.adjMinusQty;
                      const displayValue =
                        flowFilter === 'IN'
                          ? itemInTotal * item.price
                          : flowFilter === 'OUT'
                          ? itemOutTotal * item.price
                          : item.totalValue;
                      const latestMeta = latestTxByItem.get(item.codeItem.toUpperCase());

                      return (
                        <tr key={item.id} className="even:bg-slate-50/80 align-top">
                          <td className="py-1.5 px-1 text-center font-mono text-slate-500 border-r border-slate-200">
                            {rowNum}
                          </td>
                          <td className="py-1.5 px-1.5 font-mono border-r border-slate-200">
                            <div className="font-bold text-slate-900">{item.codeItem}</div>
                            <div className="text-[9px] print:text-[7.5px] text-slate-500">
                              {item.rak} • {item.typeCode}
                            </div>
                          </td>
                          <td className="py-1.5 px-2 border-r border-slate-200">
                            <div className="font-bold text-slate-900 break-words">
                              {item.partName}
                            </div>
                            <div className="font-mono text-[9px] print:text-[7.5px] text-slate-500 break-all">
                              {item.partNumber}
                            </div>
                          </td>
                          <td className="py-1.5 px-1.5 border-r border-slate-200">
                            <div className="font-mono font-bold text-slate-900 break-words">
                              {latestMeta?.codeUnit || item.codeUnit || item.modelUnit}
                            </div>
                            <div className="text-[9px] print:text-[7.5px] text-slate-500 break-words">
                              {item.modelUnit}
                            </div>
                          </td>
                          <td className="py-1.5 px-1.5 border-r border-slate-200">
                            <div className="font-semibold text-slate-900 break-words">
                              Mek: {latestMeta?.mechanic || '-'}
                            </div>
                            <div className="text-[9px] print:text-[7.5px] text-slate-600 break-words">
                              PIC: {latestMeta?.picLogistik || preparedBy}
                            </div>
                          </td>
                          <td className="py-1.5 px-1 text-right font-mono text-slate-700 border-r border-slate-200 tabular-nums">
                            {item.awalQty}
                          </td>
                          {flowFilter !== 'OUT' && (
                            <td className="py-1.5 px-1 text-right font-mono font-extrabold text-emerald-700 bg-emerald-50/50 border-r border-slate-200 tabular-nums">
                              +{itemInTotal}
                            </td>
                          )}
                          {flowFilter !== 'IN' && (
                            <td className="py-1.5 px-1 text-right font-mono font-extrabold text-rose-700 bg-rose-50/50 border-r border-slate-200 tabular-nums">
                              -{itemOutTotal}
                            </td>
                          )}
                          <td className="py-1.5 px-1.5 text-right font-mono border-r border-slate-200 tabular-nums">
                            <div className="font-extrabold text-slate-900">
                              {item.akhirQty} {item.unit}
                            </div>
                            <span
                              className={`inline-block mt-0.5 px-1 py-0.2 rounded font-mono text-[7.5px] font-extrabold ${
                                item.remark === 'ORDER'
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : item.remark === 'AMAN'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-amber-100 text-amber-900 border border-amber-300'
                              }`}
                            >
                              {item.remark}
                            </span>
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono text-slate-700 border-r border-slate-200 tabular-nums whitespace-nowrap">
                            {item.price > 0 ? formatRupiah(item.price) : item.priceNote || 'Rp0'}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                            {formatRupiah(displayValue)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                {/* GRAND TOTAL FOOTER */}
                <tfoot>
                  <tr className="bg-slate-900 text-white font-mono text-[10px] print:text-[8.5px] font-extrabold">
                    <td colSpan={5} className="py-2.5 px-2 text-right uppercase tracking-wider border-r border-slate-700">
                      GRAND TOTAL REKAPITULASI
                    </td>
                    <td className="py-2.5 px-1 text-right border-r border-slate-700 tabular-nums">
                      {reportStats.recapTotalAwal}
                    </td>
                    {flowFilter !== 'OUT' && (
                      <td className="py-2.5 px-1 text-right text-emerald-300 border-r border-slate-700 tabular-nums">
                        +{reportStats.recapTotalIn}
                      </td>
                    )}
                    {flowFilter !== 'IN' && (
                      <td className="py-2.5 px-1 text-right text-rose-300 border-r border-slate-700 tabular-nums">
                        -{reportStats.recapTotalOut}
                      </td>
                    )}
                    <td className="py-2.5 px-1.5 text-right text-amber-300 border-r border-slate-700 tabular-nums whitespace-nowrap">
                      {reportStats.recapTotalAkhir} Pcs
                    </td>
                    <td className="py-2.5 px-1.5 text-right border-r border-slate-700">
                      TOTAL:
                    </td>
                    <td className="py-2.5 px-1.5 text-right text-amber-300 tabular-nums whitespace-nowrap">
                      {formatRupiah(
                        flowFilter === 'IN'
                          ? reportStats.recapInValue
                          : flowFilter === 'OUT'
                          ? reportStats.recapOutValue
                          : reportStats.recapTotalAsset
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* 5. OFFICIAL SIGNATURE & VALIDATION BLOCK */}
        <div className="mt-8 pt-4 border-t-2 border-slate-300 grid grid-cols-3 gap-4 text-center text-[11px] print:text-[9.5px] break-inside-avoid">
          <div>
            <p className="font-bold text-slate-700 uppercase tracking-wider text-[10px] print:text-[8.5px]">
              Dibuat Oleh,
            </p>
            <div className="h-16 print:h-14" />
            <p className="font-extrabold text-slate-900 underline decoration-slate-400 underline-offset-4">
              {preparedBy}
            </p>
            <p className="text-[10px] print:text-[8.5px] text-slate-500 mt-0.5">
              Admin Inventaris Gudang
            </p>
          </div>

          <div>
            <p className="font-bold text-slate-700 uppercase tracking-wider text-[10px] print:text-[8.5px]">
              Diperiksa Oleh (PIC Logistik),
            </p>
            <div className="h-16 print:h-14" />
            <p className="font-extrabold text-slate-900 underline decoration-slate-400 underline-offset-4">
              {checkedBy}
            </p>
            <p className="text-[10px] print:text-[8.5px] text-slate-500 mt-0.5">
              PIC Logistik & Operasional
            </p>
          </div>

          <div>
            <p className="font-bold text-slate-700 uppercase tracking-wider text-[10px] print:text-[8.5px]">
              Disetujui Oleh,
            </p>
            <div className="h-16 print:h-14" />
            <p className="font-extrabold text-slate-900 underline decoration-slate-400 underline-offset-4">
              {approvedBy}
            </p>
            <p className="text-[10px] print:text-[8.5px] text-slate-500 mt-0.5">
              Kepala Gudang / Pimpinan
            </p>
          </div>
        </div>

        <div className="mt-5 pt-2.5 border-t border-slate-200 flex items-center justify-between text-[9px] font-mono text-slate-500">
          <span>Dokumen Resmi Gudang {companyName} (A4 Portrait)</span>
          <span>Author Aplikasi: Irawan</span>
        </div>
      </div>
    </div>
  );
};
