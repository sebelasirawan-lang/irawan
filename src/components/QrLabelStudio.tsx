import React, { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Printer,
  Search,
  ScanLine,
  CheckSquare,
  Square,
  MapPin,
  Tag,
  Trash2,
  QrCode,
  Hash,
  Layers,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  InventoryItem,
  QrPayloadMode,
  encodeItemQrPayload,
  ITEM_TYPE_LABELS,
} from '../types/warehouse';

export type LabelQrDisplayMode = QrPayloadMode | 'DUAL_ITEM_PN';

interface QrLabelStudioProps {
  items: InventoryItem[];
  onSimulateScanItem: (qrPayload: string) => void;
  onRequestDeleteItem?: (item: InventoryItem) => void;
}

export const QrLabelStudio: React.FC<QrLabelStudioProps> = ({
  items,
  onSimulateScanItem,
  onRequestDeleteItem,
}) => {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [qrMode, setQrMode] = useState<LabelQrDisplayMode>('DUAL_ITEM_PN');
  const [pageSize, setPageSize] = useState<number>(80);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedCodes, setSelectedCodes] = useState<string[]>(() =>
    items.slice(0, 80).map((i) => i.codeItem)
  );

  // O(1) lookup set for fast selection check across 3,000+ items
  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes]);

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((item) => {
      const matchSearch =
        !q ||
        item.codeItem.toLowerCase().includes(q) ||
        item.partName.toLowerCase().includes(q) ||
        item.partNumber.toLowerCase().includes(q) ||
        item.rak.toLowerCase().includes(q) ||
        item.modelUnit.toLowerCase().includes(q);
      const matchType = filterType === 'ALL' || item.typeCode === filterType;
      return matchSearch && matchType;
    });
  }, [items, search, filterType]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safePage, pageSize]);

  const toggleSelect = (codeItem: string) => {
    setSelectedCodes((prev) =>
      prev.includes(codeItem)
        ? prev.filter((c) => c !== codeItem)
        : [...prev, codeItem]
    );
  };

  const selectCurrentPage = () => {
    setSelectedCodes(paginatedItems.map((i) => i.codeItem));
  };

  const selectAllFiltered = () => {
    setSelectedCodes(filteredItems.map((i) => i.codeItem));
  };

  const clearSelection = () => {
    setSelectedCodes([]);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-5">
      {/* Control Bar (Hidden when printing) */}
      <div className="no-print bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Cari Code Item, Part Number, Rak, Part Name..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 outline-none"
              />
            </div>

            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
            >
              <option value="ALL">Semua Kategori (CNU / SPT / PS)</option>
              <option value="CNU">CNU - Consumable</option>
              <option value="SPT">SPT - Spare Part</option>
              <option value="PS">PS - Part Service</option>
            </select>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={selectCurrentPage}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-xs text-amber-300 font-semibold transition cursor-pointer"
              >
                Pilih Halaman Ini ({paginatedItems.length})
              </button>
              <button
                type="button"
                onClick={selectAllFiltered}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium transition cursor-pointer"
              >
                Pilih Semua ({filteredItems.length.toLocaleString('id-ID')})
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-400 font-medium transition cursor-pointer"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="text-xs text-slate-400 font-mono">
              {selectedCodes.length.toLocaleString('id-ID')} Label Dipilih
            </span>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer shadow-md"
            >
              <Printer className="w-4 h-4" />
              Cetak Label QR Halaman Ini
            </button>
          </div>
        </div>

        {/* QR Code Mode Selector Bar */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
            <QrCode className="w-4 h-4 text-amber-400" />
            <span>Pilih Format QR Code Label (Opsional Scan Masuk/Keluar):</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setQrMode('DUAL_ITEM_PN')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                qrMode === 'DUAL_ITEM_PN'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Dual QR (Code Item + QR Part Number)
            </button>
            <button
              type="button"
              onClick={() => setQrMode('PART_NUMBER')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                qrMode === 'PART_NUMBER'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Hash className="w-3.5 h-3.5" />
              QR Part Number Saja
            </button>
            <button
              type="button"
              onClick={() => setQrMode('ITEM_CODE')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                qrMode === 'ITEM_CODE'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              QR Code Item Saja
            </button>
            <button
              type="button"
              onClick={() => setQrMode('RAK')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                qrMode === 'RAK'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              QR Kode Rak Saja
            </button>
            <button
              type="button"
              onClick={() => setQrMode('COMBINED')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                qrMode === 'COMBINED'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              QR Gabungan Lengkap
            </button>
          </div>
        </div>

        {/* Pagination Strip for 3,000+ QR Labels */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-slate-400 font-mono">
            Menampilkan{' '}
            <strong className="text-slate-100">
              {filteredItems.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filteredItems.length)}
            </strong>{' '}
            dari{' '}
            <strong className="text-amber-300">
              {filteredItems.length.toLocaleString('id-ID')}
            </strong>{' '}
            Label QR Barang
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-slate-400 flex items-center gap-1.5">
              <span>Per Halaman:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-amber-300 outline-none"
              >
                <option value={40}>40 Label</option>
                <option value={80}>80 Label</option>
                <option value={160}>160 Label</option>
                <option value={300}>300 Label</option>
                <option value={500}>500 Label</option>
              </select>
            </label>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Sebelumnya
              </button>
              <span className="px-2.5 py-1 font-mono text-slate-300">
                Hal <strong className="text-amber-400">{safePage}</strong> / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                Berikutnya
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* QR Code Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 print:grid-cols-2 print:gap-4">
        {paginatedItems.map((item) => {
          const isChecked = selectedSet.has(item.codeItem);
          const singleQrMode: QrPayloadMode =
            qrMode === 'DUAL_ITEM_PN' ? 'COMBINED' : qrMode;
          const qrValue = encodeItemQrPayload(item, singleQrMode);
          const qrItemValue = encodeItemQrPayload(item, 'ITEM_CODE');
          const qrPnValue = encodeItemQrPayload(item, 'PART_NUMBER');
          const qrRakValue = encodeItemQrPayload(item, 'RAK');

          return (
            <div
              key={item.id}
              className={`bg-slate-900 border rounded-xl p-4 transition flex flex-col justify-between print:border-black print:bg-white print:text-black ${
                !isChecked
                  ? 'opacity-60 border-slate-800/60 no-print'
                  : 'border-slate-800 hover:border-amber-500/40'
              }`}
            >
              {/* Top Label Header */}
              <div>
                <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-800 print:border-slate-300">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSelect(item.codeItem)}
                      className="no-print text-amber-400 hover:text-amber-300 cursor-pointer"
                    >
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600" />
                      )}
                    </button>
                    <span className="font-mono text-sm font-extrabold text-amber-400 print:text-black">
                      {item.codeItem}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[11px] font-bold flex items-center gap-1 print:bg-gray-200 print:text-black">
                    <MapPin className="w-3 h-3 text-amber-400 print:text-black" />
                    {item.rak}
                  </span>
                </div>

                {/* Body: Dual QR Mode OR Single QR Mode */}
                {qrMode === 'DUAL_ITEM_PN' ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2.5">
                      {/* QR 1: Code Item / Rak */}
                      <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-2 flex flex-col items-center text-center print:bg-white print:border-gray-300">
                        <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-amber-400 mb-1 print:text-black">
                          QR CODE ITEM
                        </span>
                        <div className="bg-white p-1.5 rounded border border-slate-200">
                          <QRCodeSVG
                            value={qrItemValue}
                            size={74}
                            level="M"
                            includeMargin={false}
                          />
                        </div>
                        <span className="mt-1 font-mono text-[10px] font-bold text-slate-200 truncate max-w-full print:text-black">
                          {item.codeItem}
                        </span>
                      </div>

                      {/* QR 2: Part Number */}
                      <div className="bg-slate-950/90 border border-cyan-500/30 rounded-lg p-2 flex flex-col items-center text-center print:bg-white print:border-gray-300">
                        <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-cyan-400 mb-1 print:text-black">
                          QR PART NUMBER
                        </span>
                        <div className="bg-white p-1.5 rounded border border-slate-200">
                          <QRCodeSVG
                            value={qrPnValue}
                            size={74}
                            level="M"
                            includeMargin={false}
                          />
                        </div>
                        <span className="mt-1 font-mono text-[10px] font-bold text-cyan-300 truncate max-w-full print:text-black">
                          {item.partNumber}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 print:bg-gray-100 print:text-black">
                          <Tag className="w-2.5 h-2.5" />
                          {item.typeCode} • {ITEM_TYPE_LABELS[item.typeCode]?.desc}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 print:text-gray-700">
                          Unit: {item.modelUnit}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-100 leading-snug print:text-black">
                        {item.partName}
                      </h4>
                      <p className="text-xs font-mono text-cyan-300 truncate print:text-gray-800">
                        PN: {item.partNumber}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3.5">
                    <div className="flex flex-col items-center shrink-0">
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <QRCodeSVG
                          value={qrValue}
                          size={92}
                          level="M"
                          includeMargin={false}
                        />
                      </div>
                      <span className="mt-1 text-[9px] font-mono font-bold uppercase text-amber-400 print:text-black">
                        {qrMode === 'PART_NUMBER'
                          ? `PN: ${item.partNumber}`
                          : qrMode === 'RAK'
                          ? `RAK: ${item.rak}`
                          : qrMode === 'ITEM_CODE'
                          ? item.codeItem
                          : 'QR LENGKAP'}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 print:bg-gray-100 print:text-black">
                        <Tag className="w-2.5 h-2.5" />
                        {item.typeCode} • {ITEM_TYPE_LABELS[item.typeCode]?.desc}
                      </span>
                      <h4 className="text-sm font-bold text-slate-100 leading-snug print:text-black">
                        {item.partName}
                      </h4>
                      <p className="text-xs font-mono text-cyan-300 truncate print:text-gray-700">
                        PN: {item.partNumber}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate print:text-gray-700">
                        Unit: {item.modelUnit}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer Actions (Hidden when printing) */}
              <div className="no-print mt-4 pt-3 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>
                    Stok: <strong className="text-slate-200">{item.akhirQty} {item.unit}</strong>
                  </span>
                  <span className="text-[10px] text-slate-500">Uji Scan via:</span>
                </div>
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSimulateScanItem(qrItemValue)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/30 text-[10px] font-mono font-bold transition cursor-pointer"
                      title={`Simulasi Scan via Code Item (${item.codeItem})`}
                    >
                      <ScanLine className="w-3 h-3" />
                      Code Item
                    </button>
                    <button
                      type="button"
                      onClick={() => onSimulateScanItem(qrPnValue)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-cyan-500/15 hover:bg-cyan-400 text-cyan-300 hover:text-slate-950 border border-cyan-500/30 text-[10px] font-mono font-bold transition cursor-pointer"
                      title={`Simulasi Scan via QR Part Number (${item.partNumber})`}
                    >
                      <Hash className="w-3 h-3" />
                      Part Number
                    </button>
                    <button
                      type="button"
                      onClick={() => onSimulateScanItem(qrRakValue)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-400 text-emerald-300 hover:text-slate-950 border border-emerald-500/30 text-[10px] font-mono font-bold transition cursor-pointer"
                      title={`Simulasi Scan via QR Kode Rak (${item.rak})`}
                    >
                      <MapPin className="w-3 h-3" />
                      Rak
                    </button>
                  </div>

                  {onRequestDeleteItem && (
                    <button
                      type="button"
                      onClick={() => onRequestDeleteItem(item)}
                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition cursor-pointer shrink-0"
                      title="Hapus Item (Password)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
