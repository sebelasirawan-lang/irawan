import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ClipboardCheck,
  Search,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Printer,
  FileSpreadsheet,
  Download,
  Eye,
  FileText,
  RotateCcw,
  Save,
  Filter,
  User,
  UserCheck,
  MapPin,
  Boxes,
  Check,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  InventoryItem,
  formatDateDdMmmmYy,
  formatLedgerDate,
  formatRupiah,
  parsePartNumbers,
  resolveScannedItems,
} from '../types/warehouse';
import { ResetDataModal } from './ResetDataModal';

export interface OpnameEntry {
  codeItem: string;
  countedQty: number | null; // null = belum dihitung
  notes: string;
  checkedAt?: string;
  synced?: boolean;
}

export interface OpnameAdjustmentPayload {
  codeItem: string;
  physicalQty: number;
  picLogistik: string;
  auditorName: string;
  notes: string;
}

interface StockOpnamePanelProps {
  items: InventoryItem[];
  onApplyAdjustments: (adjustments: OpnameAdjustmentPayload[]) => Promise<void>;
}

const STORAGE_OPNAME_KEY = 'mme_daily_stock_opname_v1';

export const StockOpnamePanel: React.FC<StockOpnamePanelProps> = ({
  items,
  onApplyAdjustments,
}) => {
  // Opname Metadata
  const [opnameDate, setOpnameDate] = useState<string>(() => formatLedgerDate());
  const [picLogistik, setPicLogistik] = useState<string>('Irawan (PIC Logistik)');
  const [auditorName, setAuditorName] = useState<string>('Supervisor / Tim Audit');
  const [headWarehouse, setHeadWarehouse] = useState<string>('Kepala Gudang');

  // Filters & Quick Scan
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rakFilter, setRakFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'UNCOUNTED' | 'COUNTED' | 'DISCREPANCY' | 'MATCHED'
  >('ALL');
  const [quickScanInput, setQuickScanInput] = useState<string>('');
  const [quickScanFeedback, setQuickScanFeedback] = useState<{
    type: 'SUCCESS' | 'ERROR';
    message: string;
  } | null>(null);
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isResetOpnameModalOpen, setIsResetOpnameModalOpen] = useState<boolean>(false);
  const [opnamePageSize, setOpnamePageSize] = useState<number>(100);
  const [opnamePage, setOpnamePage] = useState<number>(1);
  const [isPreviewBeritaAcaraOpen, setIsPreviewBeritaAcaraOpen] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // Per-item Opname Count State (persisted in localStorage)
  const [opnameMap, setOpnameMap] = useState<Record<string, OpnameEntry>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_OPNAME_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_OPNAME_KEY, JSON.stringify(opnameMap));
    } catch {
      // ignore storage quota errors
    }
  }, [opnameMap]);

  // Unique Raks for Zone/Rack Opname Filtering
  const uniqueRaks = useMemo(() => {
    return Array.from(new Set(items.map((i) => i.rak))).sort();
  }, [items]);

  // Update single item physical count
  const handleSetCountedQty = (codeItem: string, val: number | null) => {
    setOpnameMap((prev) => {
      const existing = prev[codeItem];
      return {
        ...prev,
        [codeItem]: {
          codeItem,
          countedQty: val === null ? null : Math.max(0, val),
          notes: existing?.notes || '',
          checkedAt: val === null ? undefined : formatLedgerDate(),
          synced: false,
        },
      };
    });
  };

  // Update single item opname note
  const handleSetItemNote = (codeItem: string, notes: string) => {
    setOpnameMap((prev) => {
      const existing = prev[codeItem];
      return {
        ...prev,
        [codeItem]: {
          codeItem,
          countedQty: existing?.countedQty ?? null,
          notes,
          checkedAt: existing?.checkedAt || formatLedgerDate(),
          synced: existing?.synced || false,
        },
      };
    });
  };

  // Quick Scan QR / Barcode / Part Number / Code Item handler
  const handleQuickScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = quickScanInput.trim();
    if (!raw) return;

    const result = resolveScannedItems(raw, items);
    if (result.items.length === 0) {
      setQuickScanFeedback({
        type: 'ERROR',
        message: `Kode "${raw}" tidak ditemukan pada Code Item, Part Number, maupun Kode Rak.`,
      });
      return;
    }

    const matched = result.items[0];
    const currentEntry = opnameMap[matched.codeItem];
    const nextQty =
      currentEntry?.countedQty !== null && currentEntry?.countedQty !== undefined
        ? currentEntry.countedQty
        : matched.akhirQty;

    handleSetCountedQty(matched.codeItem, nextQty);
    setSearchQuery(matched.codeItem);
    setOpnamePage(1);
    setHighlightedCode(matched.codeItem);
    setQuickScanInput('');
    setQuickScanFeedback({
      type: 'SUCCESS',
      message: `Ditemukan [${matched.codeItem}] ${matched.partName} (Stok Sistem: ${matched.akhirQty} ${matched.unit}). Silakan sesuaikan jumlah fisik di tabel bawah.`,
    });
    setTimeout(() => setHighlightedCode(null), 4000);
  };

  // Filtered Items for Opname Table
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const entry = opnameMap[item.codeItem];
      const isCounted =
        entry !== undefined && entry.countedQty !== null && entry.countedQty !== undefined;
      const variance = isCounted ? (entry.countedQty as number) - item.akhirQty : 0;

      if (rakFilter !== 'ALL' && item.rak !== rakFilter) return false;
      if (typeFilter !== 'ALL' && item.typeCode !== typeFilter) return false;

      if (statusFilter === 'UNCOUNTED' && isCounted) return false;
      if (statusFilter === 'COUNTED' && !isCounted) return false;
      if (statusFilter === 'DISCREPANCY' && (!isCounted || variance === 0)) return false;
      if (statusFilter === 'MATCHED' && (!isCounted || variance !== 0)) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        item.codeItem.toLowerCase().includes(q) ||
        item.partName.toLowerCase().includes(q) ||
        item.partNumber.toLowerCase().includes(q) ||
        item.rak.toLowerCase().includes(q) ||
        item.modelUnit.toLowerCase().includes(q) ||
        item.codeUnit.toLowerCase().includes(q)
      );
    });
  }, [items, opnameMap, rakFilter, typeFilter, statusFilter, searchQuery]);

  const totalOpnamePages = Math.max(1, Math.ceil(filteredItems.length / opnamePageSize));
  const safeOpnamePage = Math.min(opnamePage, totalOpnamePages);

  const paginatedOpnameItems = useMemo(() => {
    const start = (safeOpnamePage - 1) * opnamePageSize;
    return filteredItems.slice(start, start + opnamePageSize);
  }, [filteredItems, safeOpnamePage, opnamePageSize]);

  // Opname Summary Statistics
  const stats = useMemo(() => {
    let countedCount = 0;
    let matchedCount = 0;
    let surplusCount = 0;
    let shortageCount = 0;
    let surplusPcs = 0;
    let shortagePcs = 0;
    let netVarianceValue = 0;

    for (const item of items) {
      const entry = opnameMap[item.codeItem];
      if (entry && entry.countedQty !== null && entry.countedQty !== undefined) {
        countedCount++;
        const diff = entry.countedQty - item.akhirQty;
        if (diff === 0) {
          matchedCount++;
        } else if (diff > 0) {
          surplusCount++;
          surplusPcs += diff;
          netVarianceValue += diff * item.price;
        } else {
          shortageCount++;
          shortagePcs += Math.abs(diff);
          netVarianceValue += diff * item.price;
        }
      }
    }

    const totalSku = items.length;
    const progressPct = totalSku > 0 ? Math.round((countedCount / totalSku) * 100) : 0;
    const progressPctPrecise =
      totalSku > 0 ? ((countedCount / totalSku) * 100).toFixed(1) : '0';
    const uncountedCount = totalSku - countedCount;
    const uncountedPct =
      totalSku > 0 ? ((uncountedCount / totalSku) * 100).toFixed(1) : '0';
    const matchedPct =
      totalSku > 0 ? ((matchedCount / totalSku) * 100).toFixed(1) : '0';
    const discrepancyCount = surplusCount + shortageCount;
    const discrepancyPct =
      totalSku > 0 ? ((discrepancyCount / totalSku) * 100).toFixed(1) : '0';

    return {
      totalSku,
      countedCount,
      uncountedCount,
      uncountedPct,
      matchedCount,
      matchedPct,
      surplusCount,
      shortageCount,
      discrepancyCount,
      discrepancyPct,
      surplusPcs,
      shortagePcs,
      netVarianceValue,
      progressPct,
      progressPctPrecise,
    };
  }, [items, opnameMap]);

  // Only items that have already been physically counted in this Opname session (sorted by Rak & Code Item)
  const countedOpnameItems = useMemo(() => {
    return items
      .filter((item) => {
        const entry = opnameMap[item.codeItem];
        return (
          entry !== undefined &&
          entry.countedQty !== null &&
          entry.countedQty !== undefined
        );
      })
      .sort((a, b) => {
        if (a.rak !== b.rak) return a.rak.localeCompare(b.rak);
        return a.codeItem.localeCompare(b.codeItem);
      });
  }, [items, opnameMap]);

  const [printWarning, setPrintWarning] = useState<string | null>(null);

  const handlePrintBeritaAcara = () => {
    if (countedOpnameItems.length === 0) {
      setPrintWarning(
        'Belum ada item yang dihitung fisik pada sesi Stock Opname ini (0 SKU / 0%). Harap input atau scan fisik barang terlebih dahulu sebelum mencetak Berita Acara.'
      );
      setTimeout(() => setPrintWarning(null), 6000);
      return;
    }
    const prevTitle = document.title;
    document.title = `Berita_Acara_Stock_Opname_${formatDateDdMmmmYy(opnameDate)}_${stats.progressPct}pct`;
    window.print();
    setTimeout(() => {
      document.title = prevTitle;
    }, 1000);
  };

  // Unduh Dokumen Berita Acara Resmi langsung ke PDF (A4 Portrait)
  const handleDownloadBeritaAcaraPdf = () => {
    if (countedOpnameItems.length === 0) {
      setPrintWarning(
        'Belum ada item yang dihitung fisik pada sesi Stock Opname ini (0 SKU / 0%). Harap input atau scan fisik barang terlebih dahulu sebelum mengunduh Berita Acara PDF.'
      );
      setTimeout(() => setPrintWarning(null), 6000);
      return;
    }

    try {
      setIsGeneratingPdf(true);
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
      const margin = 8;
      let currentY = 10;

      // 1. KOP SURAT
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(margin, currentY, 26, 6, 'F');
      doc.setFontSize(7.5);
      doc.setTextColor(251, 191, 36); // amber-400
      doc.setFont('helvetica', 'bold');
      doc.text('PT. MEGA MULTI ENERGI', margin + 1.5, currentY + 4.2);

      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `• BERITA ACARA RESMI OPNAME • Tanggal: ${formatDateDdMmmmYy(opnameDate)} • Author: Irawan`,
        margin + 28,
        currentY + 4.2
      );

      currentY += 8;

      // Judul Dokumen
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text('BERITA ACARA & LEMBAR HASIL STOCK OPNAME HARIAN', margin, currentY);

      currentY += 4.5;
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Petugas PIC Logistik: ${picLogistik} | Saksi/Pemeriksa: ${auditorName} | Kepala Gudang: ${headWarehouse}`,
        margin,
        currentY
      );

      currentY += 5;

      // Banner Persentase & Status Hanya Yang Sudah Dihitung
      doc.setFillColor(254, 243, 199); // amber-100
      doc.setDrawColor(245, 158, 11); // amber-500
      doc.roundedRect(margin, currentY, pageWidth - margin * 2, 7.5, 1.5, 1.5, 'FD');

      doc.setFontSize(7.8);
      doc.setTextColor(120, 53, 15); // amber-950
      doc.setFont('helvetica', 'bold');
      doc.text(
        `HANYA ITEM TERHITUNG FISIK: ${stats.countedCount} DARI TOTAL ${stats.totalSku} SKU (${stats.progressPct}% | ${stats.progressPctPrecise}%)`,
        margin + 3,
        currentY + 5
      );

      const summaryText = `Cocok: ${stats.matchedCount} SKU (${stats.matchedPct}%) | Selisih: ${stats.discrepancyCount} SKU (${stats.discrepancyPct}%) | Nilai Selisih: ${stats.netVarianceValue >= 0 ? '+' : ''}${formatRupiah(stats.netVarianceValue)}`;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(summaryText, pageWidth - margin - 3, currentY + 5, { align: 'right' });

      currentY += 10.5;

      // Ringkasan Eksekutif 4 Kolom
      const boxW = (pageWidth - margin * 2 - 6) / 4;
      const boxH = 11;

      // Box 1: Total Master SKU
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin, currentY, boxW, boxH, 1, 1, 'FD');
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text('TOTAL MASTER SKU', margin + 2, currentY + 3.2);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`${stats.totalSku} SKU`, margin + 2, currentY + 7.2);
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Kapasitas Master (100%)', margin + 2, currentY + 10);

      // Box 2: Selesai Dihitung Fisik
      doc.setFillColor(236, 253, 245);
      doc.setDrawColor(16, 185, 129);
      doc.roundedRect(margin + boxW + 2, currentY, boxW, boxH, 1, 1, 'FD');
      doc.setFontSize(6);
      doc.setTextColor(4, 120, 87);
      doc.text('SELESAI DIHITUNG FISIK', margin + boxW + 4, currentY + 3.2);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(6, 95, 70);
      doc.text(`${stats.countedCount} SKU`, margin + boxW + 4, currentY + 7.2);
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(4, 120, 87);
      doc.text(`${stats.progressPct}% (${stats.progressPctPrecise}%) Terverifikasi`, margin + boxW + 4, currentY + 10);

      // Box 3: Belum Diperiksa
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin + (boxW + 2) * 2, currentY, boxW, boxH, 1, 1, 'FD');
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text('BELUM DIPERIKSA', margin + (boxW + 2) * 2 + 2, currentY + 3.2);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text(`${stats.uncountedCount} SKU`, margin + (boxW + 2) * 2 + 2, currentY + 7.2);
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(`${stats.uncountedPct}% Sisa Belum Hitung`, margin + (boxW + 2) * 2 + 2, currentY + 10);

      // Box 4: Estimasi Nilai Selisih
      doc.setFillColor(254, 243, 199);
      doc.setDrawColor(245, 158, 11);
      doc.roundedRect(margin + (boxW + 2) * 3, currentY, boxW, boxH, 1, 1, 'FD');
      doc.setFontSize(6);
      doc.setTextColor(180, 83, 9);
      doc.text('ESTIMASI NILAI SELISIH', margin + (boxW + 2) * 3 + 2, currentY + 3.2);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(formatRupiah(stats.netVarianceValue), margin + (boxW + 2) * 3 + 2, currentY + 7.2);
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(180, 83, 9);
      doc.text(`${stats.discrepancyCount} SKU Memiliki Selisih`, margin + (boxW + 2) * 3 + 2, currentY + 10);

      currentY += boxH + 4;

      // 2. TABEL BERITA ACARA HANYA YANG SUDAH DIHITUNG
      const tableHeaders = [
        ['No', 'Code & Rak', 'Nama Part & Part Number', 'Code Unit', 'Sistem', 'Fisik', 'Selisih', 'Nilai Selisih', 'Catatan Temuan']
      ];

      const tableBody = countedOpnameItems.map((item, idx) => {
        const entry = opnameMap[item.codeItem];
        const physical = entry.countedQty as number;
        const diff = physical - item.akhirQty;
        const diffValue = diff * item.price;
        return [
          String(idx + 1),
          `${item.codeItem}\nRak:${item.rak}`,
          `${item.partName}\nPN:${item.partNumber} (${item.typeCode})`,
          item.codeUnit || item.modelUnit || '-',
          `${item.akhirQty} ${item.unit}`,
          `${physical} ${item.unit}`,
          diff === 0 ? 'COCOK (0)' : (diff > 0 ? `+${diff} (+ADJ)` : `${diff} (-ADJ)`),
          diff === 0 ? 'Rp0' : (diff > 0 ? `+${formatRupiah(diffValue)}` : formatRupiah(diffValue)),
          entry?.notes || '-',
        ];
      });

      const totalSistemPcs = countedOpnameItems.reduce((acc, it) => acc + it.akhirQty, 0);
      const totalFisikPcs = countedOpnameItems.reduce(
        (acc, it) => acc + (opnameMap[it.codeItem]?.countedQty || 0),
        0
      );
      const netVariancePcs = stats.surplusPcs - stats.shortagePcs;

      const tableFoot = [
        [
          `TOTAL FISIK TERHITUNG (${countedOpnameItems.length} SKU • ${stats.progressPct}% DARI TOTAL ${stats.totalSku} SKU)`,
          '',
          '',
          '',
          `${totalSistemPcs}`,
          `${totalFisikPcs}`,
          `${netVariancePcs >= 0 ? '+' : ''}${netVariancePcs} Pcs`,
          formatRupiah(stats.netVarianceValue),
          '',
        ]
      ];

      autoTable(doc, {
        startY: currentY,
        head: tableHeaders,
        body: tableBody,
        foot: tableFoot,
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
          1: { cellWidth: 20 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 18 },
          4: { cellWidth: 15, halign: 'right' },
          5: { cellWidth: 15, halign: 'right' },
          6: { cellWidth: 18, halign: 'center' },
          7: { cellWidth: 22, halign: 'right' },
          8: { cellWidth: 24 },
        },
        footStyles: {
          fillColor: [15, 23, 42],
          textColor: [251, 191, 36],
          fontSize: 6.5,
          fontStyle: 'bold',
        },
        didDrawPage: () => {
          doc.setFontSize(6);
          doc.setTextColor(148, 163, 184);
          doc.text(
            `PT. MEGA MULTI ENERGI • Berita Acara Stock Opname (Hanya Item Terhitung: ${stats.countedCount}/${stats.totalSku} SKU - ${stats.progressPct}%) • Hal ${doc.getNumberOfPages()}`,
            margin,
            doc.internal.pageSize.getHeight() - 4
          );
        },
      });

      // @ts-expect-error jspdf-autotable extends jsPDF instance with lastAutoTable
      currentY = (doc.lastAutoTable?.finalY || currentY) + 7;

      // 3. TANDA TANGAN
      if (currentY > doc.internal.pageSize.getHeight() - 32) {
        doc.addPage();
        currentY = 15;
      }

      doc.setDrawColor(203, 213, 225);
      doc.line(margin, currentY, pageWidth - margin, currentY);
      currentY += 4;

      const colWidth = (pageWidth - margin * 2) / 3;

      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'bold');
      doc.text('Dilaksanakan Oleh (PIC Logistik),', margin + colWidth * 0.5, currentY, { align: 'center' });
      doc.text('Diperiksa / Saksi Opname,', margin + colWidth * 1.5, currentY, { align: 'center' });
      doc.text('Disetujui Oleh (Kepala Gudang),', margin + colWidth * 2.5, currentY, { align: 'center' });

      currentY += 13;

      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(picLogistik, margin + colWidth * 0.5, currentY, { align: 'center' });
      doc.text(auditorName, margin + colWidth * 1.5, currentY, { align: 'center' });
      doc.text(headWarehouse, margin + colWidth * 2.5, currentY, { align: 'center' });

      currentY += 3.5;
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Petugas Pelaksana Fisik', margin + colWidth * 0.5, currentY, { align: 'center' });
      doc.text('Saksi Pemeriksaan Fisik', margin + colWidth * 1.5, currentY, { align: 'center' });
      doc.text('Kepala Gudang / Pimpinan', margin + colWidth * 2.5, currentY, { align: 'center' });

      // Simpan PDF
      doc.save(
        `Berita_Acara_Stock_Opname_${formatDateDdMmmmYy(opnameDate)}_${stats.progressPct}pct.pdf`
      );
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Bulk Action: Mark all currently filtered items as matching system stock
  const handleMarkFilteredAsMatch = () => {
    const today = formatLedgerDate();
    setOpnameMap((prev) => {
      const next = { ...prev };
      for (const item of filteredItems) {
        next[item.codeItem] = {
          codeItem: item.codeItem,
          countedQty: item.akhirQty,
          notes: prev[item.codeItem]?.notes || 'Sesuai fisik (Opname Harian)',
          checkedAt: today,
          synced: prev[item.codeItem]?.synced || false,
        };
      }
      return next;
    });
  };

  // Reset opname session
  const handleResetOpnameSession = () => {
    setOpnameMap({});
    localStorage.removeItem(STORAGE_OPNAME_KEY);
    setQuickScanFeedback(null);
  };

  // Apply single item adjustment to Master Inventory & Log Harian
  const handleApplySingleItem = async (item: InventoryItem) => {
    const entry = opnameMap[item.codeItem];
    if (!entry || entry.countedQty === null || entry.countedQty === undefined) return;
    if (entry.countedQty === item.akhirQty) {
      setOpnameMap((prev) => ({
        ...prev,
        [item.codeItem]: {
          ...entry,
          synced: true,
        },
      }));
      return;
    }

    setIsSubmitting(true);
    try {
      await onApplyAdjustments([
        {
          codeItem: item.codeItem,
          physicalQty: entry.countedQty,
          picLogistik: picLogistik.trim() || 'PIC Logistik',
          auditorName: auditorName.trim() || 'Tim Opname',
          notes:
            entry.notes.trim() ||
            `Koreksi Stock Opname Harian (${item.akhirQty} → ${entry.countedQty} ${item.unit})`,
        },
      ]);
      setOpnameMap((prev) => ({
        ...prev,
        [item.codeItem]: {
          ...entry,
          synced: true,
        },
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Apply all discrepancies to Master Inventory & Log Harian
  const handleApplyAllDiscrepancies = async () => {
    const adjustments: OpnameAdjustmentPayload[] = [];
    for (const item of items) {
      const entry = opnameMap[item.codeItem];
      if (
        entry &&
        entry.countedQty !== null &&
        entry.countedQty !== undefined &&
        entry.countedQty !== item.akhirQty
      ) {
        adjustments.push({
          codeItem: item.codeItem,
          physicalQty: entry.countedQty,
          picLogistik: picLogistik.trim() || 'PIC Logistik',
          auditorName: auditorName.trim() || 'Tim Opname',
          notes:
            entry.notes.trim() ||
            `Koreksi Stock Opname Harian (${item.akhirQty} → ${entry.countedQty} ${item.unit})`,
        });
      }
    }

    if (adjustments.length === 0) return;
    setIsSubmitting(true);
    try {
      await onApplyAdjustments(adjustments);
      setOpnameMap((prev) => {
        const next = { ...prev };
        for (const adj of adjustments) {
          if (next[adj.codeItem]) {
            next[adj.codeItem] = {
              ...next[adj.codeItem],
              synced: true,
            };
          }
        }
        return next;
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Export Stock Opname Worksheet / Report to Excel (.xlsx)
  const handleExportOpnameExcel = () => {
    const wb = XLSX.utils.book_new();
    const headers = [
      'No',
      'Code Item',
      'Kode Rak',
      'Kategori',
      'Part Name',
      'Part Number',
      'Code Unit',
      'Stok Sistem (Akhir Qty)',
      'Stok Fisik Aktual',
      'Selisih (Variance)',
      'Status Opname',
      'Satuan',
      'Harga Satuan (Rp)',
      'Nilai Selisih (Rp)',
      'PIC Logistik',
      'Pemeriksa / Saksi',
      'Catatan Opname',
    ];

    // Sheet 1: Hanya yang sudah dihitung (Berita Acara Resmi)
    const countedRows = countedOpnameItems.map((item, idx) => {
      const entry = opnameMap[item.codeItem];
      const physical = entry.countedQty as number;
      const diff = physical - item.akhirQty;
      const statusLabel =
        diff === 0
          ? 'COCOK / SESUAI'
          : diff > 0
          ? 'SELISIH LEBIH (+)'
          : 'SELISIH KURANG (-)';

      return [
        idx + 1,
        item.codeItem,
        item.rak,
        item.typeCode,
        item.partName,
        item.partNumber,
        item.codeUnit || item.modelUnit,
        item.akhirQty,
        physical,
        diff,
        statusLabel,
        item.unit,
        item.price,
        diff * item.price,
        picLogistik,
        auditorName,
        entry?.notes || '',
      ];
    });

    const wsCounted = XLSX.utils.aoa_to_sheet([
      ['PT. MEGA MULTI ENERGI'],
      [`BERITA ACARA STOCK OPNAME HARIAN - ${formatDateDdMmmmYy(opnameDate)}`],
      [`HASIL PEMERIKSAAN FISIK: ${stats.countedCount} DARI ${stats.totalSku} SKU (${stats.progressPct}%)`],
      [`PIC Logistik: ${picLogistik} | Pemeriksa: ${auditorName} | Kepala Gudang: ${headWarehouse} | Author: Irawan`],
      [],
      headers,
      ...countedRows,
    ]);
    XLSX.utils.book_append_sheet(wb, wsCounted, 'Berita_Acara_Dihitung');

    // Sheet 2: Seluruh Item untuk Lembar Kerja Audit
    const allRows = filteredItems.map((item, idx) => {
      const entry = opnameMap[item.codeItem];
      const hasCount =
        entry && entry.countedQty !== null && entry.countedQty !== undefined;
      const physical = hasCount ? (entry.countedQty as number) : '';
      const diff = hasCount ? (entry.countedQty as number) - item.akhirQty : '';
      const statusLabel = !hasCount
        ? 'BELUM DIHITUNG'
        : diff === 0
        ? 'COCOK / SESUAI'
        : (diff as number) > 0
        ? 'SELISIH LEBIH (+)'
        : 'SELISIH KURANG (-)';

      return [
        idx + 1,
        item.codeItem,
        item.rak,
        item.typeCode,
        item.partName,
        item.partNumber,
        item.codeUnit || item.modelUnit,
        item.akhirQty,
        physical,
        diff,
        statusLabel,
        item.unit,
        item.price,
        hasCount ? (diff as number) * item.price : 0,
        picLogistik,
        auditorName,
        entry?.notes || '',
      ];
    });

    const wsAll = XLSX.utils.aoa_to_sheet([
      ['PT. MEGA MULTI ENERGI'],
      [`LEMBAR KERJA LENGKAP STOCK OPNAME HARIAN - ${formatDateDdMmmmYy(opnameDate)}`],
      [`Progress: ${stats.countedCount} / ${stats.totalSku} SKU (${stats.progressPct}%) | Cocok: ${stats.matchedCount} | Selisih: ${stats.discrepancyCount} SKU`],
      [`PIC Logistik: ${picLogistik} | Pemeriksa: ${auditorName} | Author: Irawan`],
      [],
      headers,
      ...allRows,
    ]);
    XLSX.utils.book_append_sheet(wb, wsAll, 'Semua_Item_Opname');

    XLSX.writeFile(
      wb,
      `Berita_Acara_Stock_Opname_${formatDateDdMmmmYy(opnameDate)}_${stats.progressPct}pct.xlsx`
    );
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

      {/* Warning Alert if User Tries to Print with 0 Counted Items */}
      {printWarning && (
        <div className="no-print p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{printWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => setPrintWarning(null)}
            className="text-slate-400 hover:text-slate-100 cursor-pointer text-sm px-1.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* ===================================================================
          1. TOP KPI & PROGRESS SUMMARY (HIDDEN ON PRINT)
         =================================================================== */}
      <div className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Progress Opname Harian */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Progress Opname Harian
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ClipboardCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold font-mono text-slate-100">
                {stats.countedCount} / {stats.totalSku}
              </span>
              <span className="text-sm font-mono font-bold text-amber-400">
                {stats.progressPct}%
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800 mt-2 overflow-hidden">
              <div
                style={{ width: `${stats.progressPct}%` }}
                className="h-full bg-amber-500 transition-all duration-300"
              />
            </div>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Sudah dihitung: {stats.countedCount} SKU</span>
            <span>Belum: {stats.uncountedCount} SKU</span>
          </div>
        </div>

        {/* Card 2: Stok Cocok / Sesuai */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Stok Fisik Cocok (Sesuai)
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold font-mono text-emerald-400">
              {stats.matchedCount}
            </span>
            <span className="text-xs text-slate-400 font-semibold">
              Item Sesuai Sistem
            </span>
          </div>
          <div className="text-[11px] text-slate-400">
            Fisik Aktual = Saldo Akhir Sistem (Selisih 0)
          </div>
        </div>

        {/* Card 3: Selisih Lebih (+) vs Selisih Kurang (-) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Temuan Selisih (+ / -)
            </span>
            <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2 grid grid-cols-2 gap-2">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-1.5">
              <span className="text-[10px] text-blue-400 font-semibold flex items-center gap-1">
                <ArrowDownLeft className="w-3 h-3" /> LEBIH (+ADJ)
              </span>
              <span className="font-mono text-sm font-extrabold text-blue-300">
                {stats.surplusCount} SKU (+{stats.surplusPcs})
              </span>
            </div>
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">
              <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3" /> KURANG (-ADJ)
              </span>
              <span className="font-mono text-sm font-extrabold text-rose-300">
                {stats.shortageCount} SKU (-{stats.shortagePcs})
              </span>
            </div>
          </div>
          <div className="text-[11px] text-slate-400">
            Total {stats.discrepancyCount} SKU memiliki selisih fisik
          </div>
        </div>

        {/* Card 4: Nilai Finansial Selisih & Tombol Posting */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Estimasi Nilai Selisih
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <span
              className={`text-2xl font-extrabold font-mono ${
                stats.netVarianceValue > 0
                  ? 'text-blue-400'
                  : stats.netVarianceValue < 0
                  ? 'text-rose-400'
                  : 'text-emerald-400'
              }`}
            >
              {stats.netVarianceValue > 0 ? '+' : ''}
              {formatRupiah(stats.netVarianceValue)}
            </span>
          </div>
          <div>
            <button
              type="button"
              disabled={stats.discrepancyCount === 0 || isSubmitting}
              onClick={handleApplyAllDiscrepancies}
              className="w-full py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-extrabold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              {isSubmitting
                ? 'Menyinkronkan...'
                : `Sesuaikan Semua Selisih (${stats.discrepancyCount} SKU)`}
            </button>
          </div>
        </div>
      </div>

      {/* ===================================================================
          2. OPNAME CONTROL & QUICK SCAN BAR (HIDDEN ON PRINT)
         =================================================================== */}
      <div className="no-print bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Terminal Proses Stock Opname Harian Gudang
              </h2>
              <p className="text-xs text-slate-400">
                Bandingkan stok sistem vs stok fisik aktual per Rak/Part Number, catat temuan, dan sesuaikan otomatis ke Master Gudang & Log Harian
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleMarkFilteredAsMatch}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition cursor-pointer"
              title="Set stok fisik = stok sistem untuk semua barang yang sedang tampil"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Tandai Semua Tampil Cocok ({filteredItems.length})
            </button>

            <button
              type="button"
              onClick={() => setIsResetOpnameModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              title="Reset hasil input hitung fisik harian (Wajib Password)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Sesi Opname
            </button>

            <button
              type="button"
              onClick={handleExportOpnameExcel}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 text-xs font-bold transition cursor-pointer"
              title="Download Hasil Opname Lengkap ke format Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              Export Excel
            </button>

            <button
              type="button"
              disabled={isGeneratingPdf}
              onClick={handleDownloadBeritaAcaraPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-bold transition cursor-pointer disabled:opacity-50"
              title="Unduh Berita Acara resmi (Hanya yang sudah dihitung) ke file PDF"
            >
              <Download className="w-4 h-4 text-rose-400" />
              <span>{isGeneratingPdf ? 'Membuat PDF...' : `Unduh PDF (${stats.countedCount} SKU • ${stats.progressPct}%)`}</span>
            </button>

            <button
              type="button"
              onClick={handlePrintBeritaAcara}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition cursor-pointer shadow-md"
              title="Cetak Berita Acara hanya untuk item yang sudah dihitung (A4 Portrait)"
            >
              <Printer className="w-4 h-4" />
              <span>Cetak Berita Acara ({stats.countedCount} SKU • ${stats.progressPct}%)</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPreviewBeritaAcaraOpen(!isPreviewBeritaAcaraOpen)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                isPreviewBeritaAcaraOpen
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-cyan-300'
              }`}
              title="Lihat Pratinjau Dokumen Berita Acara Langsung di Layar"
            >
              <Eye className="w-4 h-4 text-cyan-400" />
              <span>{isPreviewBeritaAcaraOpen ? 'Tutup Pratinjau' : 'Pratinjau Berita Acara'}</span>
            </button>
          </div>
        </div>

        {/* Metadata Petugas Opname & Quick Scan Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-1">
              Scan Cepat QR / Ketik Part Number, Code Item, atau Rak
            </label>
            <form onSubmit={handleQuickScanSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <QrCode className="w-4 h-4 text-amber-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={quickScanInput}
                  onChange={(e) => setQuickScanInput(e.target.value)}
                  placeholder="Scan/ketik DPS-2105, ZMME-0000203, atau 101A01 lalu Enter..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-slate-100 outline-none"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs transition cursor-pointer whitespace-nowrap"
              >
                eksekusi Scan
              </button>
            </form>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Tanggal Opname (dd-mmmm-yy)
            </label>
            <input
              type="text"
              value={opnameDate}
              onChange={(e) => setOpnameDate(e.target.value)}
              onBlur={() => setOpnameDate(formatDateDdMmmmYy(opnameDate, new Date()))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-amber-300 outline-none"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              PIC Logistik (Petugas)
            </label>
            <div className="relative">
              <User className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={picLogistik}
                onChange={(e) => setPicLogistik(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-2.5 py-2 text-xs text-slate-200 outline-none"
              />
            </div>
          </div>

          <div className="lg:col-span-3">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Pemeriksa / Saksi Opname
            </label>
            <div className="relative">
              <UserCheck className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={auditorName}
                onChange={(e) => setAuditorName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-2.5 py-2 text-xs text-slate-200 outline-none"
              />
            </div>
          </div>
        </div>

        {quickScanFeedback && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
              quickScanFeedback.type === 'SUCCESS'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <span>{quickScanFeedback.message}</span>
            <button
              type="button"
              onClick={() => setQuickScanFeedback(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Search & Filter Strip */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter Code Item, Part Name, PN, Rak, Code Unit..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={rakFilter}
                onChange={(e) => setRakFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 outline-none"
              >
                <option value="ALL">Semua Lokasi Rak ({uniqueRaks.length})</option>
                {uniqueRaks.map((r) => (
                  <option key={r} value={r}>
                    Rak: {r}
                  </option>
                ))}
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 outline-none"
              >
                <option value="ALL">Semua Kategori (CNU/SPT/PS)</option>
                <option value="CNU">CNU - Consumable</option>
                <option value="SPT">SPT - Spare Part</option>
                <option value="PS">PS - Part Service</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as typeof statusFilter)
                }
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 outline-none"
              >
                <option value="ALL">Semua Status Opname ({items.length})</option>
                <option value="UNCOUNTED">
                  Belum Dihitung ({stats.uncountedCount})
                </option>
                <option value="COUNTED">Sudah Dihitung ({stats.countedCount})</option>
                <option value="DISCREPANCY">
                  Hanya Selisih +/- ({stats.discrepancyCount})
                </option>
                <option value="MATCHED">Sudah Cocok ({stats.matchedCount})</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================
          3. INTERACTIVE DAILY STOCK OPNAME WORKSHEET TABLE (SCREEN)
         =================================================================== */}
      <div className="no-print bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        {/* Pagination Strip Top */}
        <div className="px-4 py-3 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="font-mono text-slate-400">
            Menampilkan{' '}
            <strong className="text-slate-100">
              {filteredItems.length === 0
                ? 0
                : (safeOpnamePage - 1) * opnamePageSize + 1}
              –{Math.min(safeOpnamePage * opnamePageSize, filteredItems.length)}
            </strong>{' '}
            dari{' '}
            <strong className="text-amber-300">
              {filteredItems.length.toLocaleString('id-ID')}
            </strong>{' '}
            Item Opname
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="text-slate-400 flex items-center gap-1.5">
              <span>Baris per Halaman:</span>
              <select
                value={opnamePageSize}
                onChange={(e) => {
                  setOpnamePageSize(Number(e.target.value));
                  setOpnamePage(1);
                }}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-amber-300 outline-none"
              >
                <option value={50}>50 Item</option>
                <option value={100}>100 Item</option>
                <option value={250}>250 Item</option>
                <option value={500}>500 Item</option>
                <option value={3500}>Semua ({items.length})</option>
              </select>
            </label>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safeOpnamePage <= 1}
                onClick={() => setOpnamePage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Sebelumnya
              </button>
              <span className="px-2.5 py-1 font-mono text-slate-300">
                Hal <strong className="text-amber-400">{safeOpnamePage}</strong> /{' '}
                {totalOpnamePages}
              </span>
              <button
                type="button"
                disabled={safeOpnamePage >= totalOpnamePages}
                onClick={() =>
                  setOpnamePage((p) => Math.min(totalOpnamePages, p + 1))
                }
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                Berikutnya
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="py-3 px-3 text-center">No</th>
                <th className="py-3 px-3">Code Item & Rak</th>
                <th className="py-3 px-3">Part Name & Part Number</th>
                <th className="py-3 px-3">Code Unit / Model</th>
                <th className="py-3 px-3 text-right bg-slate-900/70">
                  Stok Sistem
                </th>
                <th className="py-3 px-3 text-center bg-amber-950/25 text-amber-300">
                  Input Stok Fisik Aktual
                </th>
                <th className="py-3 px-3 text-center">Selisih (Variance)</th>
                <th className="py-3 px-3">Catatan Temuan Opname</th>
                <th className="py-3 px-3 text-center">Aksi Opname</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {paginatedOpnameItems.map((item) => {
                const entry = opnameMap[item.codeItem];
                const hasCount =
                  entry !== undefined &&
                  entry.countedQty !== null &&
                  entry.countedQty !== undefined;
                const countedVal = hasCount ? (entry.countedQty as number) : '';
                const variance = hasCount
                  ? (entry.countedQty as number) - item.akhirQty
                  : null;
                const isHighlighted = highlightedCode === item.codeItem;

                return (
                  <tr
                    key={item.id}
                    className={`transition ${
                      isHighlighted
                        ? 'bg-amber-500/20 ring-1 ring-amber-400'
                        : hasCount && variance !== 0
                        ? 'bg-rose-950/15 hover:bg-rose-950/25'
                        : hasCount && variance === 0
                        ? 'bg-emerald-950/10 hover:bg-slate-800/50'
                        : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <td className="py-3 px-3 text-center font-mono text-slate-400">
                      {item.no}
                    </td>
                    <td className="py-3 px-3 font-mono">
                      <div className="font-bold text-amber-400">{item.codeItem}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-emerald-400" />
                        {item.rak} ({item.typeCode})
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-100">{item.partName}</div>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {parsePartNumbers(item.partNumber).map((pn, idx) => (
                          <span
                            key={`${item.codeItem}-opn-${idx}`}
                            className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[10px] text-cyan-300"
                          >
                            {idx === 0 ? `PN: ${pn}` : `Ref: ${pn}`}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-mono font-semibold text-slate-200">
                        {item.codeUnit || item.modelUnit}
                      </div>
                      <div className="text-[11px] text-slate-400">{item.modelUnit}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono bg-slate-900/50">
                      <span className="text-sm font-extrabold text-slate-100">
                        {item.akhirQty}
                      </span>{' '}
                      <span className="text-[10px] text-slate-400">{item.unit}</span>
                    </td>

                    {/* Input Stok Fisik Aktual */}
                    <td className="py-3 px-3 bg-amber-950/10">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleSetCountedQty(
                              item.codeItem,
                              Math.max(
                                0,
                                (hasCount ? (entry.countedQty as number) : item.akhirQty) - 1
                              )
                            )
                          }
                          className="w-7 h-7 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 font-mono font-bold text-slate-200 cursor-pointer"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={0}
                          value={countedVal}
                          placeholder={String(item.akhirQty)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '') {
                              handleSetCountedQty(item.codeItem, null);
                            } else {
                              handleSetCountedQty(
                                item.codeItem,
                                Math.max(0, parseInt(raw, 10) || 0)
                              );
                            }
                          }}
                          className="w-20 h-8 bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-lg text-center font-mono text-xs font-extrabold text-amber-300 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            handleSetCountedQty(
                              item.codeItem,
                              (hasCount ? (entry.countedQty as number) : item.akhirQty) + 1
                            )
                          }
                          className="w-7 h-7 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 font-mono font-bold text-slate-200 cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </td>

                    {/* Variance / Selisih Badge */}
                    <td className="py-3 px-3 text-center font-mono">
                      {!hasCount ? (
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                          BELUM DIHITUNG
                        </span>
                      ) : variance === 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-extrabold">
                          <Check className="w-3 h-3" /> COCOK (0)
                        </span>
                      ) : (variance as number) > 0 ? (
                        <div>
                          <span className="inline-block px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 text-[10px] font-extrabold">
                            +{variance} {item.unit} (+ADJ)
                          </span>
                          <div className="text-[10px] text-blue-400 mt-0.5">
                            +{formatRupiah((variance as number) * item.price)}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <span className="inline-block px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-extrabold">
                            {variance} {item.unit} (-ADJ)
                          </span>
                          <div className="text-[10px] text-rose-400 mt-0.5">
                            {formatRupiah((variance as number) * item.price)}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Catatan Temuan Opname */}
                    <td className="py-3 px-3">
                      <input
                        type="text"
                        value={entry?.notes || ''}
                        onChange={(e) => handleSetItemNote(item.codeItem, e.target.value)}
                        placeholder="Catatan fisik / rak / kondisi..."
                        className="w-full min-w-[160px] bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
                      />
                    </td>

                    {/* Tombol Aksi Cepat Per Baris */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSetCountedQty(item.codeItem, item.akhirQty)}
                          className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer ${
                            hasCount && variance === 0
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700'
                          }`}
                          title="Set Fisik = Stok Sistem"
                        >
                          Sesuai
                        </button>

                        {hasCount && variance !== 0 && (
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleApplySingleItem(item)}
                            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-[11px] transition cursor-pointer whitespace-nowrap"
                            title="Terapkan koreksi selisih ini ke Stok Master & Log Harian"
                          >
                            Sesuaikan Stok
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===================================================================
          4. OFFICIAL BERITA ACARA STOCK OPNAME HARIAN
          HANYA MENAMPILKAN BARANG YANG SUDAH DIHITUNG & PERSENTASE DARI TOTAL SKU
         =================================================================== */}
      <div
        className={`${
          isPreviewBeritaAcaraOpen ? 'block my-6' : 'hidden'
        } print:block print-only bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 p-5 sm:p-8 print:shadow-none print:border-none print:p-0 print:rounded-none max-w-[210mm] print:max-w-none print:w-full mx-auto`}
      >
        {/* Banner Navigasi Pratinjau (Hanya Tampil di Layar saat Mode Pratinjau Aktif) */}
        {isPreviewBeritaAcaraOpen && (
          <div className="no-print -mt-2 -mx-2 mb-6 p-4 rounded-xl bg-slate-900 text-slate-100 flex flex-wrap items-center justify-between gap-3 shadow-md border border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center font-bold">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-100">
                  Pratinjau Lembar Berita Acara Stock Opname (A4 Portrait)
                </p>
                <p className="text-[11px] text-amber-300 font-mono">
                  Hanya Item Terhitung Fisik: {stats.countedCount} dari {stats.totalSku} SKU ({stats.progressPct}% | {stats.progressPctPrecise}%)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isGeneratingPdf}
                onClick={handleDownloadBeritaAcaraPdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isGeneratingPdf ? 'Membuat PDF...' : 'Unduh PDF'}</span>
              </button>
              <button
                type="button"
                onClick={handlePrintBeritaAcara}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak / Simpan PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPreviewBeritaAcaraOpen(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition cursor-pointer"
              >
                ✕ Tutup
              </button>
            </div>
          </div>
        )}

        <div className="border-b-4 border-slate-900 pb-4 mb-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-extrabold border border-slate-900 shrink-0">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-900 text-amber-400">
                  PT. MEGA MULTI ENERGI
                </span>
                <span className="text-[10px] font-mono text-slate-600 font-semibold">
                  • BERITA ACARA RESMI OPNAME
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  • Author: Irawan
                </span>
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 mt-1">
                BERITA ACARA & LEMBAR HASIL STOCK OPNAME HARIAN
              </h1>
              <p className="text-xs text-slate-600">
                Tanggal Opname: <strong>{formatDateDdMmmmYy(opnameDate)}</strong> • PIC Logistik:{' '}
                <strong>{picLogistik}</strong> • Saksi / Pemeriksa: <strong>{auditorName}</strong> • Kepala Gudang: <strong>{headWarehouse}</strong>
              </p>
            </div>
          </div>

          <div className="text-right font-mono space-y-1 shrink-0">
            <div className="inline-block px-3 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-950 font-extrabold text-xs">
              REALISASI: {stats.countedCount} / {stats.totalSku} SKU ({stats.progressPct}% | {stats.progressPctPrecise}%)
            </div>
            <div className="text-xs font-bold text-slate-800">
              Persentase Terhitung: <span className="text-amber-700">{stats.progressPct}% ({stats.progressPctPrecise}%)</span> dari Total Master SKU
            </div>
            <div className="text-[11px] text-slate-600">
              Cocok: {stats.matchedCount} SKU ({stats.matchedPct}%) • Selisih: {stats.discrepancyCount} SKU ({stats.discrepancyPct}%)
            </div>
          </div>
        </div>

        {/* Ringkasan Eksekutif Opname & Persentase Total SKU */}
        <div className="grid grid-cols-4 gap-2.5 mb-4 text-xs font-mono">
          <div className="p-2.5 rounded-lg border border-slate-300 bg-slate-50">
            <span className="text-[9px] font-bold text-slate-500 block uppercase">Total Master SKU</span>
            <span className="text-base font-extrabold text-slate-900">{stats.totalSku} SKU</span>
            <span className="text-[9px] text-slate-500 block">Kapasitas Master (100%)</span>
          </div>
          <div className="p-2.5 rounded-lg border border-emerald-300 bg-emerald-50">
            <span className="text-[9px] font-bold text-emerald-800 block uppercase">Selesai Dihitung Fisik</span>
            <span className="text-base font-extrabold text-emerald-700">{stats.countedCount} SKU</span>
            <span className="text-[9px] text-emerald-800 font-bold block">{stats.progressPct}% ({stats.progressPctPrecise}%) Terverifikasi</span>
          </div>
          <div className="p-2.5 rounded-lg border border-slate-300 bg-slate-50">
            <span className="text-[9px] font-bold text-slate-500 block uppercase">Belum Diperiksa</span>
            <span className="text-base font-extrabold text-slate-600">{stats.uncountedCount} SKU</span>
            <span className="text-[9px] text-slate-500 block">{stats.uncountedPct}% Sisa Belum Hitung</span>
          </div>
          <div className="p-2.5 rounded-lg border border-amber-300 bg-amber-50">
            <span className="text-[9px] font-bold text-amber-800 block uppercase">Estimasi Nilai Selisih</span>
            <span className="text-base font-extrabold text-slate-900">{formatRupiah(stats.netVarianceValue)}</span>
            <span className="text-[9px] text-amber-800 block">{stats.discrepancyCount} SKU ({stats.discrepancyPct}%) Selisih</span>
          </div>
        </div>

        {/* Tabel Berita Acara: HANYA MENAMPILKAN BARANG YANG SUDAH DIHITUNG */}
        {countedOpnameItems.length === 0 ? (
          <div className="p-8 border-2 border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-600 bg-slate-50 my-6">
            <p className="font-extrabold text-slate-900 text-sm mb-1">
              Belum Ada Item Yang Dihitung Fisik (0 SKU / 0%)
            </p>
            <p>
              Berita Acara ini dikonfigurasi untuk hanya mencetak barang yang sudah dihitung fisik.
              Silakan input jumlah fisik barang terlebih dahulu pada tabel Stock Opname.
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-[10px] border border-slate-300">
            <thead>
              <tr className="bg-slate-900 text-white text-[9px] uppercase font-bold tracking-tight">
                <th className="py-2 px-1.5 border-r border-slate-700 text-center w-8">No</th>
                <th className="py-2 px-2 border-r border-slate-700 w-24">Code Item & Rak</th>
                <th className="py-2 px-2 border-r border-slate-700">Part Name & Part Number</th>
                <th className="py-2 px-2 border-r border-slate-700 w-20">Code Unit</th>
                <th className="py-2 px-2 border-r border-slate-700 text-right w-16">Stok Sistem</th>
                <th className="py-2 px-2 border-r border-slate-700 text-right w-16">Stok Fisik</th>
                <th className="py-2 px-2 border-r border-slate-700 text-center w-24">Selisih Fisik</th>
                <th className="py-2 px-2 border-r border-slate-700 text-right w-24">Nilai Selisih (Rp)</th>
                <th className="py-2 px-2">Catatan Temuan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {countedOpnameItems.map((item, idx) => {
                const entry = opnameMap[item.codeItem];
                const physicalQty = entry.countedQty as number;
                const diff = physicalQty - item.akhirQty;
                const diffValue = diff * item.price;
                return (
                  <tr key={item.id} className="even:bg-slate-50/80 align-top">
                    <td className="py-1.5 px-1.5 text-center font-mono border-r border-slate-200">
                      {idx + 1}
                    </td>
                    <td className="py-1.5 px-2 font-mono border-r border-slate-200">
                      <div className="font-bold text-slate-900">{item.codeItem}</div>
                      <div className="text-[9px] text-slate-500">Rak: {item.rak}</div>
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200">
                      <div className="font-bold text-slate-900">{item.partName}</div>
                      <div className="font-mono text-[9px] text-slate-500">
                        {item.partNumber} ({item.typeCode})
                      </div>
                    </td>
                    <td className="py-1.5 px-2 font-mono border-r border-slate-200">
                      {item.codeUnit || item.modelUnit}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono border-r border-slate-200">
                      {item.akhirQty} {item.unit}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono font-extrabold border-r border-slate-200 text-slate-900">
                      {physicalQty} {item.unit}
                    </td>
                    <td className="py-1.5 px-2 text-center font-mono font-bold border-r border-slate-200">
                      {diff === 0 ? (
                        <span className="text-emerald-700 font-extrabold">COCOK (0)</span>
                      ) : diff > 0 ? (
                        <span className="text-blue-700 font-extrabold">+{diff} {item.unit} (+ADJ)</span>
                      ) : (
                        <span className="text-rose-700 font-extrabold">{diff} {item.unit} (-ADJ)</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono border-r border-slate-200">
                      {diff === 0 ? 'Rp0' : (diff > 0 ? `+${formatRupiah(diffValue)}` : formatRupiah(diffValue))}
                    </td>
                    <td className="py-1.5 px-2 text-slate-700">{entry?.notes || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 text-white font-mono text-[10px] font-extrabold">
                <td colSpan={4} className="py-2.5 px-2 text-right uppercase tracking-wider border-r border-slate-700">
                  TOTAL DIHITUNG ({countedOpnameItems.length} SKU • {stats.progressPct}% DARI TOTAL {stats.totalSku} SKU)
                </td>
                <td className="py-2.5 px-2 text-right border-r border-slate-700">
                  {countedOpnameItems.reduce((acc, it) => acc + it.akhirQty, 0)}
                </td>
                <td className="py-2.5 px-2 text-right border-r border-slate-700 text-amber-300">
                  {countedOpnameItems.reduce(
                    (acc, it) => acc + (opnameMap[it.codeItem]?.countedQty || 0),
                    0
                  )}
                </td>
                <td className="py-2.5 px-2 text-center border-r border-slate-700 text-amber-300">
                  {stats.surplusPcs - stats.shortagePcs > 0
                    ? `+${stats.surplusPcs - stats.shortagePcs}`
                    : `${stats.surplusPcs - stats.shortagePcs}`}{' '}
                  Pcs
                </td>
                <td className="py-2.5 px-2 text-right border-r border-slate-700 text-amber-300">
                  {formatRupiah(stats.netVarianceValue)}
                </td>
                <td className="py-2.5 px-2"></td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Tanda Tangan Berita Acara */}
        <div className="mt-8 pt-4 border-t-2 border-slate-300 grid grid-cols-3 gap-6 text-center text-xs break-inside-avoid">
          <div>
            <p className="font-bold uppercase text-[10px] text-slate-700">Dilaksanakan Oleh (PIC Logistik),</p>
            <div className="h-16" />
            <p className="font-extrabold underline text-slate-900">{picLogistik}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Petugas Pelaksana Stock Opname</p>
          </div>
          <div>
            <p className="font-bold uppercase text-[10px] text-slate-700">Diperiksa / Saksi Opname,</p>
            <div className="h-16" />
            <p className="font-extrabold underline text-slate-900">{auditorName}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Saksi Pemeriksaan Fisik</p>
          </div>
          <div>
            <p className="font-bold uppercase text-[10px] text-slate-700">Disetujui Oleh (Kepala Gudang),</p>
            <div className="h-16" />
            <p className="font-extrabold underline text-slate-900">{headWarehouse}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Kepala Gudang / Pimpinan</p>
          </div>
        </div>

        <div className="mt-5 pt-2 border-t border-slate-200 flex items-center justify-between text-[9px] font-mono text-slate-500">
          <span>
            Dokumen Berita Acara Resmi PT. Mega Multi Energi • Realisasi Hitung: {stats.countedCount} dari {stats.totalSku} Total SKU ({stats.progressPct}% | {stats.progressPctPrecise}%) • Hanya Item Terhitung
          </span>
          <span>Author Aplikasi: Irawan</span>
        </div>
      </div>

      {isResetOpnameModalOpen && (
        <ResetDataModal
          title="Otorisasi Reset Sesi Stock Opname"
          description="Tindakan ini akan mengosongkan kembali seluruh input perhitungan fisik pada sesi Stock Opname Harian saat ini."
          confirmLabel="Konfirmasi Reset Opname"
          onClose={() => setIsResetOpnameModalOpen(false)}
          onConfirmReset={handleResetOpnameSession}
        />
      )}
    </div>
  );
};
