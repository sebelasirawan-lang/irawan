import React, { useState } from 'react';
import { Trash2, X, Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { InventoryItem } from '../types/warehouse';

interface DeleteItemModalProps {
  item: InventoryItem;
  onClose: () => void;
  onConfirmDelete: (codeItem: string) => Promise<void>;
}

const REQUIRED_DELETE_PASSWORD = '11tiga89';

export const DeleteItemModal: React.FC<DeleteItemModalProps> = ({
  item,
  onClose,
  onConfirmDelete,
}) => {
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== REQUIRED_DELETE_PASSWORD) {
      setError('Password otorisasi salah! Penghapusan dibatalkan.');
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      await onConfirmDelete(item.codeItem);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus barang.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                Hapus Item Gudang
              </h3>
              <p className="text-xs text-slate-400">
                Konfirmasi penghapusan permanen dengan password
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Item Summary */}
        <div className="mt-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-amber-400">
              {item.codeItem}
            </span>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              Rak: {item.rak}
            </span>
          </div>
          <p className="text-sm font-bold text-slate-100">{item.partName}</p>
          <p className="text-xs font-mono text-slate-400">
            PN: {item.partNumber} • Stok Akhir: {item.akhirQty} {item.unit}
          </p>
        </div>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Masukkan Password Otorisasi Hapus
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoFocus
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Masukkan password..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-rose-500 rounded-lg pl-9 pr-10 py-2 text-xs font-mono text-slate-100 outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200 p-0.5"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isDeleting || !password}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition cursor-pointer shadow-md"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isDeleting ? 'Menghapus...' : 'Hapus Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
