import React, { useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  Calendar,
  CalendarDays,
  CalendarRange,
  ArrowDownLeft,
  ArrowUpRight,
  Printer,
  Filter,
  Layers,
  TrendingUp,
  AlertTriangle,
  PackageCheck,
} from 'lucide-react';
import {
  InventoryItem,
  WarehouseTransaction,
  formatLedgerDate,
  formatRupiah,
  ITEM_TYPE_LABELS,
} from '../types/warehouse';
import {
  exportPeriodReportToExcel,
  PeriodSummaryItem,
} from '../utils/excelExport';

interface ReportAnalyticsPanelProps {
  items: InventoryItem[];
  transactions: WarehouseTransaction[];
}

export const ReportAnalyticsPanel: React.FC<ReportAnalyticsPanelProps> = ({
  items,
  transactions,
}) => {
  const [periodMode, setPeriodMode] = useState<'HARIAN' | 'MINGGUAN' | 'BULANAN'>('HARIAN');
  const [selectedDailyDate, setSelectedDailyDate] = useState<string>('ALL_TODAY');
  const [selectedWeeklyRange, setSelectedWeeklyRange] = useState<'7_DAYS' | '14_DAYS' | '30_DAYS'>('7_DAYS');
  const [selectedMonth, setSelectedMonth] = useState<string>('Sep-26');
  const [viewSection, setViewSection] = useState<'SKU_SUMMARY' | 'TX_DETAIL' | 'CATEGORY_BREAKDOWN'>('SKU_SUMMARY');
  const [onlyMovedItems, setOnlyMovedItems] = useState<boolean>(false);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const todayLedger = formatLedgerDate();

  // Extract unique dates available in transactions for Harian selector
  const availableDates = useMemo(() => {
    const set = new Set<string>([todayLedger]);
    transactions.forEach((tx) => {
      if (tx.dateStr) set.add(tx.dateStr);
    });
    return Array.from(set);
  }, [transactions, todayLedger]);

  // Filter transactions based on Period Mode (Harian / Mingguan / Bulanan)
  const periodTransactions = useMemo(() => {
    const now = Date.now();
    return transactions.filter((tx) => {
      if (typeFilter !== 'ALL' && tx.typeCode !== typeFilter) return false;

      if (periodMode === 'HARIAN') {
        if (selectedDailyDate === 'ALL_TODAY') {
          // Match today's date string or transactions within the last 24 hours
          return (
            tx.dateStr === todayLedger ||
            now - (tx.timestampMs || 0) <= 24 * 60 * 60 * 1000
          );
        }
        return tx.dateStr === selectedDailyDate;
      }

      if (periodMode === 'MINGGUAN') {
        const days =
          selectedWeeklyRange === '7_DAYS'
            ? 7
            : selectedWeeklyRange === '14_DAYS'
            ? 14
            : 30;
        const cutoff = now - days * 24 * 60 * 60 * 1000;
        return (tx.timestampMs || 0) >= cutoff;
      }

      if (periodMode === 'BULANAN') {
        if (selectedMonth === 'ALL') return true;
        if (selectedMonth === 'Sep-26') {
          return tx.dateStr.includes('Sep');
        }
        if (selectedMonth === 'Aug-26') {
          return tx.dateStr.includes('Aug');
        }
        if (selectedMonth === 'Jul-26') {
          return tx.dateStr.includes('Jul') || tx.dateStr.includes('Juli');
        }
        return true;
      }

      return true;
    });
  }, [
    transactions,
    periodMode,
    selectedDailyDate,
    selectedWeeklyRange,
    selectedMonth,
    typeFilter,
    todayLedger,
  ]);

  // Human-readable label for the active period
  const periodLabel = useMemo(() => {
    if (periodMode === 'HARIAN') {
      return selectedDailyDate === 'ALL_TODAY'
        ? `Harian (${todayLedger} / 24 Jam Terakhir)`
        : `Tanggal ${selectedDailyDate}`;
    }
    if (periodMode === 'MINGGUAN') {
      return selectedWeeklyRange === '7_DAYS'
        ? '7 Hari Terakhir (Minggu Ini)'
        : selectedWeeklyRange === '14_DAYS'
        ? '14 Hari Terakhir (2 Minggu)'
        : '30 Hari Terakhir';
    }
    if (selectedMonth === 'ALL') {
      return 'Akumulasi Seluruh Bulan (Master Ledger)';
    }
    if (selectedMonth === 'Sep-26') return 'Bulan September 2026';
    if (selectedMonth === 'Aug-26') return 'Bulan Agustus 2026';
    if (selectedMonth === 'Jul-26') return 'Bulan Juli 2026';
    return selectedMonth;
  }, [periodMode, selectedDailyDate, selectedWeeklyRange, selectedMonth, todayLedger]);

  // Build per-SKU summary rows for the selected period
  const summaryRows: PeriodSummaryItem[] = useMemo(() => {
    const filteredMaster = items.filter(
      (i) => typeFilter === 'ALL' || i.typeCode === typeFilter
    );

    const rows = filteredMaster.map((item) => {
      // If Monthly "ALL" is selected, show the full cumulative ledger from the master sheet
      if (periodMode === 'BULANAN' && selectedMonth === 'ALL') {
        const itemTxs = periodTransactions.filter(
          (t) => t.codeItem === item.codeItem
        );
        return {
          item,
          periodIn: item.inQty,
          periodOut: item.outQty,
          periodAdjPlus: item.adjPlusQty,
          periodAdjMinus: item.adjMinusQty,
          txCount: Math.max(itemTxs.length, item.inQty > 0 || item.outQty > 0 ? 1 : 0),
          periodInValue: (item.inQty + item.adjPlusQty) * item.price,
          periodOutValue: (item.outQty + item.adjMinusQty) * item.price,
        };
      }

      const itemTxs = periodTransactions.filter(
        (t) => t.codeItem.toUpperCase() === item.codeItem.toUpperCase()
      );
      const periodIn = itemTxs
        .filter((t) => t.txType === 'IN')
        .reduce((s, t) => s + t.qty, 0);
      const periodOut = itemTxs
        .filter((t) => t.txType === 'OUT')
        .reduce((s, t) => s + t.qty, 0);
      const periodAdjPlus = itemTxs
        .filter((t) => t.txType === 'ADJ_PLUS')
        .reduce((s, t) => s + t.qty, 0);
      const periodAdjMinus = itemTxs
        .filter((t) => t.txType === 'ADJ_MINUS')
        .reduce((s, t) => s + t.qty, 0);

      return {
        item,
        periodIn,
        periodOut,
        periodAdjPlus,
        periodAdjMinus,
        txCount: itemTxs.length,
        periodInValue: (periodIn + periodAdjPlus) * item.price,
        periodOutValue: (periodOut + periodAdjMinus) * item.price,
      };
    });

    if (onlyMovedItems) {
      return rows.filter(
        (r) =>
          r.periodIn > 0 ||
          r.periodOut > 0 ||
          r.periodAdjPlus > 0 ||
          r.periodAdjMinus > 0
      );
    }
    return rows;
  }, [items, periodTransactions, periodMode, selectedMonth, onlyMovedItems, typeFilter]);

  // Period KPI Totals
  const periodStats = useMemo(() => {
    const totalIn = summaryRows.reduce((s, r) => s + r.periodIn + r.periodAdjPlus, 0);
    const totalOut = summaryRows.reduce((s, r) => s + r.periodOut + r.periodAdjMinus, 0);
    const totalInValue = summaryRows.reduce((s, r) => s + r.periodInValue, 0);
    const totalOutValue = summaryRows.reduce((s, r) => s + r.periodOutValue, 0);
    const activeSkus = summaryRows.filter(
      (r) => r.periodIn > 0 || r.periodOut > 0 || r.periodAdjPlus > 0 || r.periodAdjMinus > 0
    ).length;
    const criticalOrderSkus = summaryRows.filter((r) => r.item.remark === 'ORDER').length;

    return {
      totalIn,
      totalOut,
      totalInValue,
      totalOutValue,
      activeSkus,
      criticalOrderSkus,
    };
  }, [summaryRows]);

  const handleExportExcel = () => {
    exportPeriodReportToExcel({
      periodMode,
      periodLabel,
      summaryRows,
      periodTransactions,
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Report Control & Period Switcher Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 font-mono text-xs font-bold text-emerald-300">
                LAPORAN TERPADU (.XLSX)
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Periode Aktif: <strong className="text-amber-400">{periodLabel}</strong>
              </span>
            </div>
            <h2 className="text-lg font-extrabold text-slate-100 mt-1">
              Laporan Pemasukan & Pengeluaran Gudang (Harian / Mingguan / Bulanan)
            </h2>
          </div>

          {/* Export to Excel (.xlsx) & Print Buttons */}
          <div className="no-print flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer"
            >
              <Printer className="w-4 h-4 text-slate-300" />
              Cetak Laporan
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs transition cursor-pointer shadow-lg shadow-emerald-500/20"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Laporan ke Excel (.xlsx)
            </button>
          </div>
        </div>

        {/* Period Type Tabs + Period Specific Selectors */}
        <div className="no-print mt-4 flex flex-wrap items-center justify-between gap-4">
          {/* 1. Harian / Mingguan / Bulanan Toggle */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setPeriodMode('HARIAN')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                periodMode === 'HARIAN'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Laporan Harian
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode('MINGGUAN')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                periodMode === 'MINGGUAN'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CalendarRange className="w-4 h-4" />
              Laporan Mingguan
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode('BULANAN')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                periodMode === 'BULANAN'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CalendarDays className="w-4 h-4" />
              Laporan Bulanan
            </button>
          </div>

          {/* 2. Contextual Date / Week / Month Filter */}
          <div className="flex flex-wrap items-center gap-2.5">
            {periodMode === 'HARIAN' && (
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
                <span className="text-xs text-slate-400 font-medium">Pilih Tanggal:</span>
                <select
                  value={selectedDailyDate}
                  onChange={(e) => setSelectedDailyDate(e.target.value)}
                  className="bg-transparent text-xs font-mono font-bold text-amber-400 outline-none"
                >
                  <option value="ALL_TODAY" className="bg-slate-900 text-slate-100">
                    Hari Ini ({todayLedger} / 24 Jam Terakhir)
                  </option>
                  {availableDates.map((d) => (
                    <option key={d} value={d} className="bg-slate-900 text-slate-100">
                      Tanggal: {d}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {periodMode === 'MINGGUAN' && (
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
                <span className="text-xs text-slate-400 font-medium">Rentang Minggu:</span>
                <select
                  value={selectedWeeklyRange}
                  onChange={(e) =>
                    setSelectedWeeklyRange(
                      e.target.value as '7_DAYS' | '14_DAYS' | '30_DAYS'
                    )
                  }
                  className="bg-transparent text-xs font-mono font-bold text-amber-400 outline-none"
                >
                  <option value="7_DAYS" className="bg-slate-900 text-slate-100">
                    7 Hari Terakhir (Minggu Ini)
                  </option>
                  <option value="14_DAYS" className="bg-slate-900 text-slate-100">
                    14 Hari Terakhir (2 Minggu)
                  </option>
                  <option value="30_DAYS" className="bg-slate-900 text-slate-100">
                    30 Hari Terakhir (4 Minggu)
                  </option>
                </select>
              </div>
            )}

            {periodMode === 'BULANAN' && (
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
                <span className="text-xs text-slate-400 font-medium">Pilih Bulan:</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-transparent text-xs font-mono font-bold text-amber-400 outline-none"
                >
                  <option value="Sep-26" className="bg-slate-900 text-slate-100">
                    September 2026
                  </option>
                  <option value="Aug-26" className="bg-slate-900 text-slate-100">
                    Agustus 2026
                  </option>
                  <option value="Jul-26" className="bg-slate-900 text-slate-100">
                    Juli 2026
                  </option>
                  <option value="ALL" className="bg-slate-900 text-slate-100">
                    Akumulasi Seluruh Periode (Total Master)
                  </option>
                </select>
              </div>
            )}

            {/* Category Filter */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-transparent text-xs text-slate-200 outline-none"
              >
                <option value="ALL" className="bg-slate-900">
                  Semua Kategori (CNU/SPT/PS)
                </option>
                <option value="CNU" className="bg-slate-900">
                  CNU - Consumable
                </option>
                <option value="SPT" className="bg-slate-900">
                  SPT - Spare Part
                </option>
                <option value="PS" className="bg-slate-900">
                  PS - Part Service
                </option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyMovedItems}
                onChange={(e) => setOnlyMovedItems(e.target.checked)}
                className="accent-amber-500 rounded"
              />
              Hanya barang yang bergerak
            </label>
          </div>
        </div>
      </div>

      {/* Period Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
            <span>TOTAL PEMASUKAN ({periodMode})</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold font-mono text-emerald-400 tabular-nums">
              +{periodStats.totalIn.toLocaleString('id-ID')}
            </span>
            <span className="text-xs text-slate-400">Pcs</span>
          </div>
          <p className="text-[11px] font-mono text-slate-400 mt-1">
            Nilai Masuk: <strong className="text-slate-200">{formatRupiah(periodStats.totalInValue)}</strong>
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
            <span>TOTAL PENGELUARAN ({periodMode})</span>
            <ArrowUpRight className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold font-mono text-rose-400 tabular-nums">
              -{periodStats.totalOut.toLocaleString('id-ID')}
            </span>
            <span className="text-xs text-slate-400">Pcs</span>
          </div>
          <p className="text-[11px] font-mono text-slate-400 mt-1">
            Nilai Keluar: <strong className="text-slate-200">{formatRupiah(periodStats.totalOutValue)}</strong>
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
            <span>AKTIVITAS SKU & TRANSAKSI</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold font-mono text-amber-400 tabular-nums">
              {periodTransactions.length}
            </span>
            <span className="text-xs text-slate-400">
              Transaksi ({periodStats.activeSkus} SKU aktif)
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Tercatat via QR Scanner & Dashboard
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
            <span>REKOMENDASI ORDER (RESTOCK)</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold font-mono text-rose-400 tabular-nums">
              {periodStats.criticalOrderSkus}
            </span>
            <span className="text-xs text-slate-400">Barang berstatus ORDER</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Stok Akhir di bawah batas maksimum rak
          </p>
        </div>
      </div>

      {/* Sub-navigation for Report Tables */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewSection('SKU_SUMMARY')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              viewSection === 'SKU_SUMMARY'
                ? 'bg-slate-800 text-amber-400 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PackageCheck className="w-4 h-4" />
            Rekap Mutasi Per Barang ({summaryRows.length} SKU)
          </button>
          <button
            type="button"
            onClick={() => setViewSection('TX_DETAIL')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              viewSection === 'TX_DETAIL'
                ? 'bg-slate-800 text-amber-400 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Rincian Log Transaksi Periode ({periodTransactions.length})
          </button>
          <button
            type="button"
            onClick={() => setViewSection('CATEGORY_BREAKDOWN')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              viewSection === 'CATEGORY_BREAKDOWN'
                ? 'bg-slate-800 text-amber-400 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            Rekap Per Kategori & Model Unit
          </button>
        </div>

        <span className="text-xs text-slate-400 font-mono">
          Format Export: Microsoft Excel (.xlsx) Multi-Sheet
        </span>
      </div>

      {/* SECTION 1: SKU Movement Summary Table */}
      {viewSection === 'SKU_SUMMARY' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-3 text-center">No</th>
                  <th className="py-3 px-3">Code Item</th>
                  <th className="py-3 px-3">Rak / Type</th>
                  <th className="py-3 px-3">Part Name & Part Number</th>
                  <th className="py-3 px-3">Model Unit</th>
                  <th className="py-3 px-3 text-right bg-emerald-950/30 text-emerald-400">
                    Masuk ({periodMode})
                  </th>
                  <th className="py-3 px-2.5 text-right bg-blue-950/20 text-blue-400">
                    Adj (+)
                  </th>
                  <th className="py-3 px-3 text-right bg-rose-950/30 text-rose-400">
                    Keluar ({periodMode})
                  </th>
                  <th className="py-3 px-2.5 text-right bg-amber-950/20 text-amber-400">
                    Adj (-)
                  </th>
                  <th className="py-3 px-3 text-right bg-slate-950 text-amber-300">
                    Stok Akhir
                  </th>
                  <th className="py-3 px-2.5 text-center">Remark</th>
                  <th className="py-3 px-3 text-right">Nilai Keluar Periode</th>
                  <th className="py-3 px-3 text-right">Total Nilai Aset</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {summaryRows.map((row) => {
                  const { item } = row;
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-3 text-center font-mono text-slate-400">
                        {item.no}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-amber-400">
                        {item.codeItem}
                      </td>
                      <td className="py-3 px-3 font-mono">
                        <span className="text-slate-200">{item.rak}</span>
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                          {item.typeCode}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-100">{item.partName}</div>
                        <div className="font-mono text-[11px] text-slate-400">
                          {item.partNumber}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-300">{item.modelUnit}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400 tabular-nums bg-emerald-950/10">
                        {row.periodIn > 0 ? `+${row.periodIn}` : '0'}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono text-blue-300 tabular-nums">
                        {row.periodAdjPlus > 0 ? `+${row.periodAdjPlus}` : '0'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-rose-400 tabular-nums bg-rose-950/10">
                        {row.periodOut > 0 ? `-${row.periodOut}` : '0'}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono text-amber-300 tabular-nums">
                        {row.periodAdjMinus > 0 ? `-${row.periodAdjMinus}` : '0'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-extrabold text-slate-100 tabular-nums bg-slate-950/60">
                        {item.akhirQty} {item.unit}
                      </td>
                      <td className="py-3 px-2.5 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                            item.remark === 'ORDER'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : item.remark === 'AMAN'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {item.remark}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-300 tabular-nums">
                        {formatRupiah(row.periodOutValue)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400 tabular-nums">
                        {formatRupiah(item.totalValue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 2: Detailed Period Transactions */}
      {viewSection === 'TX_DETAIL' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Tanggal</th>
                  <th className="py-3 px-4">Tipe</th>
                  <th className="py-3 px-4">Code Item & Rak</th>
                  <th className="py-3 px-4">Part Name & PN</th>
                  <th className="py-3 px-4 text-right">Qty</th>
                  <th className="py-3 px-4 text-right">Perubahan Stok</th>
                  <th className="py-3 px-4">Petugas / Unit</th>
                  <th className="py-3 px-4">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {periodTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400">
                      Tidak ada transaksi pada periode <strong>{periodLabel}</strong>.
                    </td>
                  </tr>
                ) : (
                  periodTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-300">{tx.dateStr}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${
                            tx.txType === 'IN' || tx.txType === 'ADJ_PLUS'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {tx.txType}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <span className="font-bold text-amber-400">{tx.codeItem}</span>
                        <span className="block text-[11px] text-slate-400">Rak: {tx.rak}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-100">{tx.partName}</div>
                        <div className="font-mono text-[11px] text-slate-400">
                          {tx.partNumber}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-extrabold text-slate-100">
                        {tx.qty} Pcs
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300">
                        {tx.prevAkhirQty} → <strong>{tx.newAkhirQty}</strong>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-200">{tx.picName}</div>
                        <div className="text-[11px] text-slate-400">{tx.unitRef}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{tx.notes}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 3: Breakdown by Category (CNU / SPT / PS) & Model Unit */}
      {viewSection === 'CATEGORY_BREAKDOWN' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Breakdown by Type Code */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-100 mb-3">
              Rekap Berdasarkan Kategori Barang (Type Code)
            </h3>
            <div className="space-y-3">
              {(['CNU', 'SPT', 'PS'] as const).map((typeCode) => {
                const group = summaryRows.filter((r) => r.item.typeCode === typeCode);
                const groupIn = group.reduce((s, r) => s + r.periodIn + r.periodAdjPlus, 0);
                const groupOut = group.reduce((s, r) => s + r.periodOut + r.periodAdjMinus, 0);
                const groupAkhir = group.reduce((s, r) => s + r.item.akhirQty, 0);
                const groupAsset = group.reduce((s, r) => s + r.item.totalValue, 0);

                return (
                  <div
                    key={typeCode}
                    className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono text-xs font-bold">
                        {typeCode}
                      </span>
                      <span className="ml-2 text-sm font-bold text-slate-100">
                        {ITEM_TYPE_LABELS[typeCode].desc}
                      </span>
                      <p className="text-xs text-slate-400 mt-1">
                        {group.length} SKU • Stok Akhir: <strong className="text-slate-200">{groupAkhir} Pcs</strong>
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-xs">
                        <span className="text-emerald-400 font-bold">IN: +{groupIn}</span>
                        <span className="mx-2 text-slate-600">|</span>
                        <span className="text-rose-400 font-bold">OUT: -{groupOut}</span>
                      </div>
                      <div className="text-xs font-bold text-slate-200 mt-1">
                        Aset: {formatRupiah(groupAsset)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Breakdown by Model Unit */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-100 mb-3">
              Rekap Berdasarkan Model Unit Alat
            </h3>
            <div className="space-y-3">
              {Array.from(new Set(items.map((i) => i.modelUnit))).map((unitName) => {
                const group = summaryRows.filter((r) => r.item.modelUnit === unitName);
                const groupIn = group.reduce((s, r) => s + r.periodIn + r.periodAdjPlus, 0);
                const groupOut = group.reduce((s, r) => s + r.periodOut + r.periodAdjMinus, 0);
                const groupAkhir = group.reduce((s, r) => s + r.item.akhirQty, 0);
                const groupAsset = group.reduce((s, r) => s + r.item.totalValue, 0);

                return (
                  <div
                    key={unitName}
                    className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <span className="text-sm font-bold text-slate-100">{unitName}</span>
                      <p className="text-xs text-slate-400 mt-1">
                        {group.length} SKU • Stok Akhir: <strong className="text-slate-200">{groupAkhir} Pcs</strong>
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-xs">
                        <span className="text-emerald-400 font-bold">IN: +{groupIn}</span>
                        <span className="mx-2 text-slate-600">|</span>
                        <span className="text-rose-400 font-bold">OUT: -{groupOut}</span>
                      </div>
                      <div className="text-xs font-bold text-emerald-400 mt-1">
                        Aset: {formatRupiah(groupAsset)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
