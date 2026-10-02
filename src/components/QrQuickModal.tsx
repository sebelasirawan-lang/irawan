import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, ScanLine, Printer, MapPin, Hash, QrCode, Layers } from 'lucide-react';
import {
  InventoryItem,
  QrPayloadMode,
  encodeItemQrPayload,
  formatRupiah,
  parsePartNumbers,
  ITEM_TYPE_LABELS,
} from '../types/warehouse';

interface QrQuickModalProps {
  item: InventoryItem;
  initialMode?: QrPayloadMode;
  initialPartNumber?: string;
  onClose: () => void;
  onOpenInScanner: (qrPayload: string) => void;
}

export const QrQuickModal: React.FC<QrQuickModalProps> = ({
  item,
  initialMode = 'PART_NUMBER',
  initialPartNumber,
  onClose,
  onOpenInScanner,
}) => {
  const allPartNumbers = parsePartNumbers(item.partNumber);
  const [selectedMode, setSelectedMode] = useState<QrPayloadMode>(initialMode);
  const [activePn, setActivePn] = useState<string>(
    initialPartNumber && allPartNumbers.includes(initialPartNumber)
      ? initialPartNumber
      : allPartNumbers[0] || item.partNumber
  );

  const qrPayload = encodeItemQrPayload(item, selectedMode, activePn);

  const modeLabels: Record<
    QrPayloadMode,
    { title: string; badge: string; desc: string }
  > = {
    PART_NUMBER: {
      title: 'QR Part Number',
      badge: `PN: ${activePn}`,
      desc: 'Scan menggunakan Part Number (Utama / Referensi) untuk transaksi Masuk / Keluar',
    },
    ITEM_CODE: {
      title: 'QR Code Item',
      badge: item.codeItem,
      desc: 'Scan menggunakan Code Item (DPS-xxxx)',
    },
    RAK: {
      title: 'QR Kode Rak',
      badge: `RAK: ${item.rak}`,
      desc: 'Scan menggunakan Kode Lokasi Rak Gudang',
    },
    COMBINED: {
      title: 'QR Gabungan',
      badge: `${item.codeItem} | ${activePn} | ${item.rak}`,
      desc: 'Format lengkap (Code Item + Part Number + Kode Rak)',
    },
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded bg-amber-500/15 border border-amber-500/40 font-mono text-xs font-bold text-amber-300">
              {item.codeItem}
            </span>
            <span className="px-2.5 py-1 rounded bg-cyan-500/15 border border-cyan-500/40 font-mono text-xs font-bold text-cyan-300 flex items-center gap-1">
              <Hash className="w-3.5 h-3.5" />
              {activePn}
            </span>
            <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-amber-400" />
              Rak {item.rak}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector Tabs: Part Number / Code Item / Kode Rak / Gabungan */}
        <div className="mt-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Pilih Jenis QR Code (Opsional Scan Masuk / Keluar):
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setSelectedMode('PART_NUMBER')}
              className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                selectedMode === 'PART_NUMBER'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Hash className="w-3.5 h-3.5" />
              Part Number
            </button>
            <button
              type="button"
              onClick={() => setSelectedMode('ITEM_CODE')}
              className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                selectedMode === 'ITEM_CODE'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              Code Item
            </button>
            <button
              type="button"
              onClick={() => setSelectedMode('RAK')}
              className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                selectedMode === 'RAK'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Kode Rak
            </button>
            <button
              type="button"
              onClick={() => setSelectedMode('COMBINED')}
              className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                selectedMode === 'COMBINED'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Gabungan
            </button>
          </div>
        </div>

        {/* Multi-Part-Number Selector if item has >1 Part Number */}
        {allPartNumbers.length > 1 && (
          <div className="mt-3 p-2.5 rounded-xl bg-slate-950 border border-cyan-500/30">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-cyan-400 mb-1.5">
              Pilih Part Number / Referensi PN ({allPartNumbers.length} Tersedia):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {allPartNumbers.map((pn, idx) => (
                <button
                  key={`${pn}-${idx}`}
                  type="button"
                  onClick={() => {
                    setActivePn(pn);
                    setSelectedMode('PART_NUMBER');
                  }}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition cursor-pointer ${
                    activePn === pn
                      ? 'bg-cyan-500 text-slate-950 shadow-sm'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-cyan-500/40'
                  }`}
                >
                  {idx === 0 ? `Utama: ${pn}` : `Ref #${idx}: ${pn}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active QR Code Display */}
        <div className="my-5 flex flex-col items-center text-center">
          <div className="mb-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-xs font-extrabold ${
                selectedMode === 'PART_NUMBER'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : selectedMode === 'RAK'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}
            >
              {modeLabels[selectedMode].title}: {modeLabels[selectedMode].badge}
            </span>
          </div>

          <div
            className={`bg-white p-4 rounded-2xl shadow-lg border-4 ${
              selectedMode === 'PART_NUMBER'
                ? 'border-cyan-500/40'
                : selectedMode === 'RAK'
                ? 'border-emerald-500/40'
                : 'border-amber-500/40'
            }`}
          >
            <QRCodeSVG value={qrPayload} size={180} level="H" includeMargin={false} />
          </div>

          <p className="mt-2 text-xs font-mono text-slate-300 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 break-all">
            Payload: <strong className="text-amber-300">{qrPayload}</strong>
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {modeLabels[selectedMode].desc}
          </p>

          <h3 className="mt-3 text-base font-bold text-slate-100">{item.partName}</h3>
          <p className="text-xs font-mono text-slate-400">
            Semua PN: <span className="text-cyan-300 font-bold">{item.partNumber}</span> •{' '}
            {item.typeCode} ({ITEM_TYPE_LABELS[item.typeCode]?.desc})
          </p>

          <div className="mt-4 w-full grid grid-cols-3 gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3">
            <div>
              <span className="text-[10px] text-slate-400 block">Stok Akhir</span>
              <span className="font-mono text-sm font-bold text-slate-100">
                {item.akhirQty} {item.unit}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">Min / Max</span>
              <span className="font-mono text-sm font-bold text-slate-300">
                {item.minQty} / {item.maxQty}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">Harga</span>
              <span className="font-mono text-xs font-bold text-amber-400">
                {item.price > 0 ? formatRupiah(item.price) : item.priceNote || 'Rp0'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Cetak QR Ini
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenInScanner(qrPayload);
            }}
            className="flex-1 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <ScanLine className="w-4 h-4" />
            Scan via {modeLabels[selectedMode].title}
          </button>
        </div>
      </div>
    </div>
  );
};
