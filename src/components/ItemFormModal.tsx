import React, { useState } from 'react';
import { X, Save, PackagePlus, Plus, Trash2, Hash, QrCode } from 'lucide-react';
import {
  InventoryItem,
  ItemTypeCode,
  MovementCategory,
  calculateAkhirQty,
  calculateMovementStatus,
  calculateRemark,
  calculateTotalValue,
  formatDateDdMmmmYy,
  formatLedgerDate,
  formatPartNumbers,
  parsePartNumbers,
} from '../types/warehouse';

interface ItemFormModalProps {
  initialItem?: InventoryItem | null;
  nextNo: number;
  onClose: () => void;
  onSave: (item: InventoryItem) => Promise<void>;
}

export const ItemFormModal: React.FC<ItemFormModalProps> = ({
  initialItem,
  nextNo,
  onClose,
  onSave,
}) => {
  const isEdit = Boolean(initialItem);

  const initialPnList = initialItem?.partNumber
    ? parsePartNumbers(initialItem.partNumber)
    : [];

  const [no, setNo] = useState<number>(initialItem?.no ?? nextNo);
  const [codeItem, setCodeItem] = useState<string>(initialItem?.codeItem ?? 'DPS-');
  const [rak, setRak] = useState<string>(initialItem?.rak ?? '101A01');
  const [typeCode, setTypeCode] = useState<ItemTypeCode>(initialItem?.typeCode ?? 'CNU');
  const [modelUnit, setModelUnit] = useState<string>(initialItem?.modelUnit ?? 'POMPA');
  const [primaryPartNumber, setPrimaryPartNumber] = useState<string>(
    initialPnList[0] && initialPnList[0] !== '-' ? initialPnList[0] : ''
  );
  const [refPartNumbers, setRefPartNumbers] = useState<string[]>(
    initialPnList.slice(1)
  );
  const [newRefPnInput, setNewRefPnInput] = useState<string>('');

  const [partName, setPartName] = useState<string>(initialItem?.partName ?? '');
  const [codeUnit, setCodeUnit] = useState<string>(initialItem?.codeUnit ?? 'Water Pump');
  const [supplier, setSupplier] = useState<string>(initialItem?.supplier ?? 'Jaya Putra Mandiri');
  const [brand, setBrand] = useState<string>(initialItem?.brand ?? 'N-BK');
  const [awalQty, setAwalQty] = useState<number>(initialItem?.awalQty ?? 0);
  const [unit, setUnit] = useState<string>(initialItem?.unit ?? 'Pcs');
  const [inQty, setInQty] = useState<number>(initialItem?.inQty ?? 0);
  const [adjPlusQty, setAdjPlusQty] = useState<number>(initialItem?.adjPlusQty ?? 0);
  const [outQty, setOutQty] = useState<number>(initialItem?.outQty ?? 0);
  const [adjMinusQty, setAdjMinusQty] = useState<number>(initialItem?.adjMinusQty ?? 0);
  const [minQty, setMinQty] = useState<number>(initialItem?.minQty ?? 5);
  const [maxQty, setMaxQty] = useState<number>(initialItem?.maxQty ?? 10);
  const [tanggalUpdate, setTanggalUpdate] = useState<string>(
    initialItem?.tanggalUpdate
      ? formatDateDdMmmmYy(initialItem.tanggalUpdate)
      : formatLedgerDate()
  );
  const [price, setPrice] = useState<number>(initialItem?.price ?? 0);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const akhirQty = calculateAkhirQty(awalQty, inQty, adjPlusQty, outQty, adjMinusQty);
  const remark = calculateRemark(akhirQty, minQty, maxQty);
  const totalValue = calculateTotalValue(akhirQty, price);
  const movementStatus: MovementCategory = calculateMovementStatus(tanggalUpdate);

  const handleAddRefPn = () => {
    const trimmed = newRefPnInput.trim();
    if (!trimmed) return;
    const subParts = parsePartNumbers(trimmed);
    setRefPartNumbers((prev) => {
      const next = [...prev];
      for (const sp of subParts) {
        if (
          sp.toUpperCase() !== primaryPartNumber.trim().toUpperCase() &&
          !next.some((existing) => existing.toUpperCase() === sp.toUpperCase())
        ) {
          next.push(sp);
        }
      }
      return next;
    });
    setNewRefPnInput('');
  };

  const handleUpdateRefPnAt = (idx: number, val: string) => {
    setRefPartNumbers((prev) => prev.map((item, i) => (i === idx ? val : item)));
  };

  const handleRemoveRefPnAt = (idx: number) => {
    setRefPartNumbers((prev) => prev.filter((_, i) => i !== idx));
  };

  const combinedPnPreview = formatPartNumbers([
    primaryPartNumber,
    ...refPartNumbers,
    ...(newRefPnInput.trim() ? [newRefPnInput.trim()] : []),
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedCode = codeItem.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!cleanedCode) {
      setError('Kode Item wajib diisi (contoh: DPS-2801)');
      return;
    }
    if (awalQty + inQty + adjPlusQty - outQty - adjMinusQty < 0) {
      setError('Stok Akhir tidak boleh bernilai negatif. Periksa kembali jumlah Awal/IN/OUT.');
      return;
    }

    const finalPartNumber = formatPartNumbers([
      primaryPartNumber.trim() || '-',
      ...refPartNumbers,
      ...(newRefPnInput.trim() ? [newRefPnInput.trim()] : []),
    ]);

    setSaving(true);
    setError(null);
    const today = formatLedgerDate();
    try {
      const updatedItem: InventoryItem = {
        id: cleanedCode,
        no: Math.max(1, no),
        codeItem: cleanedCode,
        rak: rak.trim() || '101A01',
        typeCode,
        modelUnit: modelUnit.trim() || 'UNIT',
        partNumber: finalPartNumber,
        partName: partName.trim() || 'Nama Part',
        codeUnit: codeUnit.trim() || modelUnit.trim() || 'UNIT',
        tanggalUpdate: formatDateDdMmmmYy(tanggalUpdate || today, new Date()),
        tanggalMasuk: formatDateDdMmmmYy(initialItem?.tanggalMasuk || today, new Date()),
        tanggalKeluar: formatDateDdMmmmYy(initialItem?.tanggalKeluar || today, new Date()),
        supplier: supplier.trim() || '-',
        brand: brand.trim() || '-',
        awalQty,
        unit: unit.trim() || 'Pcs',
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
        updatedByUid: initialItem?.updatedByUid || 'admin',
      };
      await onSave(updatedItem);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan data barang');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl my-8">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                {isEdit ? `Edit Master Barang: ${initialItem?.codeItem}` : 'Tambah Barang Gudang Baru'}
              </h3>
              <p className="text-xs text-slate-400">
                Mendukung Multi / Referensi Part Number & Kalkulasi Stok Otomatis
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

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">No Urut</label>
              <input
                type="number"
                required
                min={1}
                value={no}
                onChange={(e) => setNo(parseInt(e.target.value, 10) || 1)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Code Item (QR ID)</label>
              <input
                type="text"
                required
                disabled={isEdit}
                value={codeItem}
                onChange={(e) => setCodeItem(e.target.value.toUpperCase())}
                placeholder="DPS-2801"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono font-bold text-amber-400 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Code Rak</label>
              <input
                type="text"
                required
                value={rak}
                onChange={(e) => setRak(e.target.value)}
                placeholder="101A01"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Type Code</label>
              <select
                value={typeCode}
                onChange={(e) => setTypeCode(e.target.value as ItemTypeCode)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
              >
                <option value="CNU">CNU (Consumable)</option>
                <option value="SPT">SPT (Spare Part)</option>
                <option value="PS">PS (Part Service)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Part Name (Nama Barang)</label>
              <input
                type="text"
                required
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                placeholder="Karet Kopling F3"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-cyan-400 mb-1">
                Part Number Utama *
              </label>
              <input
                type="text"
                required
                value={primaryPartNumber}
                onChange={(e) => setPrimaryPartNumber(e.target.value)}
                placeholder="ZMME-0000203"
                className="w-full bg-slate-950 border border-cyan-500/40 focus:border-cyan-400 rounded-lg px-3 py-2 text-xs font-mono font-bold text-cyan-300 outline-none"
              />
            </div>
          </div>

          {/* Multi / Reference Part Number Section */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-cyan-400" />
                <div>
                  <h4 className="text-xs font-bold text-slate-200">
                    Referensi Part Number (Persamaan / Multi Part Number)
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    1 barang dapat memiliki beberapa Part Number berbeda. Semua Part Number otomatis bisa dipakai Scan QR Masuk/Keluar.
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 font-mono text-[10px] font-bold text-cyan-300">
                {parsePartNumbers(combinedPnPreview).length} Part Number Aktif
              </span>
            </div>

            {/* Existing Reference Part Numbers List */}
            {refPartNumbers.length > 0 && (
              <div className="space-y-2">
                {refPartNumbers.map((refPn, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-1.5 rounded-lg shrink-0">
                      Ref PN #{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={refPn}
                      onChange={(e) => handleUpdateRefPnAt(idx, e.target.value)}
                      placeholder="Kode referensi part number..."
                      className="flex-1 bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveRefPnAt(idx)}
                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition cursor-pointer"
                      title="Hapus Referensi Part Number ini"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add New Reference Part Number Input */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newRefPnInput}
                onChange={(e) => setNewRefPnInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddRefPn();
                  }
                }}
                placeholder="Ketik referensi Part Number tambahan (cth: 15601-E0240 /LF-3400)..."
                className="flex-1 bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 outline-none"
              />
              <button
                type="button"
                onClick={handleAddRefPn}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-slate-950 border border-cyan-500/40 text-xs font-bold transition cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Referensi PN
              </button>
            </div>

            {/* Active Part Numbers Summary Badges */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-slate-400 flex items-center gap-1 mr-1">
                <QrCode className="w-3 h-3 text-cyan-400" />
                Semua PN Terdaftar:
              </span>
              {parsePartNumbers(combinedPnPreview).map((pn, i) => (
                <span
                  key={`${pn}-${i}`}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                    i === 0
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  {i === 0 ? `Utama: ${pn}` : `Ref ${i}: ${pn}`}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Model Unit</label>
              <input
                type="text"
                required
                value={modelUnit}
                onChange={(e) => setModelUnit(e.target.value)}
                placeholder="POMPA / HINO 500"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Code Unit</label>
              <input
                type="text"
                required
                value={codeUnit}
                onChange={(e) => setCodeUnit(e.target.value)}
                placeholder="Water Pump / Light Vehicle"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Supplier</label>
              <input
                type="text"
                required
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Jaya Putra Mandiri"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Brand / Merk</label>
              <input
                type="text"
                required
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="N-BK / Toyota Genuine Part"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
              />
            </div>
          </div>

          {/* Stock Ledger Quantities */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-xs font-bold text-slate-300 mb-2.5 flex items-center justify-between">
              <span>Kuantitas Stok & Batas Min/Max</span>
              <span className="font-mono text-amber-400">
                Stok Akhir: {akhirQty} {unit} ({remark})
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2.5">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Awal</label>
                <input
                  type="number"
                  min={0}
                  value={awalQty}
                  onChange={(e) => setAwalQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] text-emerald-400 mb-1">IN Qty</label>
                <input
                  type="number"
                  min={0}
                  value={inQty}
                  onChange={(e) => setInQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-blue-400 mb-1">(+) Adj</label>
                <input
                  type="number"
                  min={0}
                  value={adjPlusQty}
                  onChange={(e) => setAdjPlusQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-blue-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-rose-400 mb-1">OUT Qty</label>
                <input
                  type="number"
                  min={0}
                  value={outQty}
                  onChange={(e) => setOutQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-rose-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-amber-400 mb-1">(-) Adj</label>
                <input
                  type="number"
                  min={0}
                  value={adjMinusQty}
                  onChange={(e) => setAdjMinusQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-amber-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">MIN</label>
                <input
                  type="number"
                  min={0}
                  value={minQty}
                  onChange={(e) => setMinQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">MAX</label>
                <input
                  type="number"
                  min={0}
                  value={maxQty}
                  onChange={(e) => setMaxQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-slate-100"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Harga Satuan (Rp)</label>
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Status Moving (Otomatis)
              </label>
              <div
                className={`w-full rounded-lg px-3 py-2 text-xs font-mono font-bold border flex items-center justify-between ${
                  movementStatus === 'Fast Moving'
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : movementStatus === 'Slow Moving'
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                    : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                }`}
                title="<3 bln: Fast Moving | 3-12 bln: Slow Moving | ≥12 bln: Dead Moving"
              >
                <span>{movementStatus}</span>
                <span className="text-[10px] opacity-80">
                  {movementStatus === 'Fast Moving'
                    ? '< 3 Bln'
                    : movementStatus === 'Slow Moving'
                    ? '3–12 Bln'
                    : '≥ 12 Bln'}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Satuan (Unit)</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-amber-400 mb-1">
                Tanggal Update (dd-mmmm-yy)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={tanggalUpdate}
                  onChange={(e) => setTanggalUpdate(e.target.value)}
                  onBlur={() => setTanggalUpdate(formatDateDdMmmmYy(tanggalUpdate, new Date()))}
                  placeholder="30-September-26"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg px-2.5 py-2 text-xs font-mono text-amber-300"
                />
                <input
                  type="date"
                  aria-label="Pilih Tanggal Update dari Kalender"
                  onChange={(e) => {
                    if (e.target.value) {
                      setTanggalUpdate(formatDateDdMmmmYy(e.target.value, new Date()));
                    }
                  }}
                  className="w-8 h-8 bg-slate-950 border border-slate-800 hover:border-amber-500 rounded-lg px-1.5 text-xs text-slate-300 cursor-pointer shrink-0"
                  title="Pilih Tanggal Update dari Kalender"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Menyimpan...' : 'Simpan Data Barang'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
