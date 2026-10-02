import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { User } from 'firebase/auth';
import {
  Cloud,
  UploadCloud,
  DownloadCloud,
  RefreshCw,
  Trash2,
  FileSpreadsheet,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  X,
  ShieldCheck,
} from 'lucide-react';
import { getAccessToken, googleSignIn, initAuth } from '../firebase';
import {
  InventoryItem,
  WarehouseTransaction,
  formatDateDdMmmmYy,
  formatLedgerDate,
  formatRupiah,
  splitPicAndRecipient,
} from '../types/warehouse';

const TARGET_DRIVE_EMAIL = 'sebelasirawan@gmail.com';
const DRIVE_FOLDER_NAME = 'PT_Mega_Multi_Energi_Cloud_Gudang';
const PRIMARY_DB_FILENAME = 'MME_Database_Gudang_Cloud.json';

interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

interface PendingConfirmAction {
  type: 'OVERWRITE_DB' | 'DELETE_FILE' | 'RESTORE_FILE';
  title: string;
  description: string;
  confirmLabel: string;
  targetFile?: DriveFileItem;
}

interface GoogleDriveModalProps {
  items: InventoryItem[];
  transactions: WarehouseTransaction[];
  onClose: () => void;
  onRestoreFromDrive: (data: {
    items: InventoryItem[];
    transactions: WarehouseTransaction[];
    fileName: string;
  }) => Promise<void>;
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  items,
  transactions,
  onClose,
  onRestoreFromDrive,
}) => {
  const [needsAuth, setNeedsAuth] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(null);
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const [folderId, setFolderId] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'SUCCESS' | 'ERROR' | 'INFO';
    text: string;
  } | null>(null);

  // Mandatory User Confirmation Dialog state for mutating/destructive operations
  const [pendingAction, setPendingAction] = useState<PendingConfirmAction | null>(
    null
  );

  useEffect(() => {
    const unsub = initAuth(
      (u, accessToken) => {
        setDriveUser(u);
        setToken(accessToken);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
        setToken(null);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (token && !needsAuth) {
      loadDriveWorkspace(token);
    }
  }, [token, needsAuth]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setStatusMessage(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setDriveUser(result.user);
        setNeedsAuth(false);
        setStatusMessage({
          type: 'SUCCESS',
          text: `Terhubung ke Google Drive (${result.user.email || TARGET_DRIVE_EMAIL}).`,
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'ERROR',
        text:
          err instanceof Error
            ? `Gagal masuk Google Drive: ${err.message}`
            : 'Gagal menghubungkan akun Google Drive.',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Ensure dedicated warehouse folder exists in Google Drive
  const ensureWarehouseFolder = async (accessToken: string): Promise<string> => {
    const q = encodeURIComponent(
      `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`
    );
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (searchRes.status === 401) {
      setNeedsAuth(true);
      throw new Error('Sesi token Google Drive berakhir. Silakan masuk kembali.');
    }

    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // Create folder if not found
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    if (!createRes.ok) {
      throw new Error('Gagal membuat folder penyimpanan di Google Drive.');
    }
    const created = await createRes.json();
    return created.id;
  };

  // Load files stored by this app in Google Drive
  const loadDriveWorkspace = async (overrideToken?: string) => {
    const activeToken = overrideToken || (await getAccessToken());
    if (!activeToken) {
      setNeedsAuth(true);
      return;
    }

    setIsLoadingFiles(true);
    try {
      const fId = await ensureWarehouseFolder(activeToken);
      setFolderId(fId);

      const q = encodeURIComponent(`'${fId}' in parents and trashed=false`);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=30&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)`,
        {
          headers: { Authorization: `Bearer ${activeToken}` },
        }
      );

      if (res.status === 401) {
        setNeedsAuth(true);
        return;
      }

      const data = await res.json();
      setDriveFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setStatusMessage({
        type: 'ERROR',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal memuat daftar file dari Google Drive.',
      });
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Build JSON payload for Google Drive Cloud Database
  const buildDatabasePayload = () => {
    return JSON.stringify(
      {
        company: 'PT. Mega Multi Energi',
        author: 'Irawan',
        targetDriveAccount: TARGET_DRIVE_EMAIL,
        syncedAt: new Date().toISOString(),
        syncedDateFormatted: formatLedgerDate(),
        totalItems: items.length,
        totalTransactions: transactions.length,
        items,
        transactions,
      },
      null,
      2
    );
  };

  // Upload new file or update existing file in Google Drive using multipart upload
  const uploadMultipartToDrive = async (params: {
    fileName: string;
    mimeType: string;
    contentBlob: Blob;
    existingFileId?: string;
  }) => {
    const activeToken = await getAccessToken();
    if (!activeToken) {
      setNeedsAuth(true);
      throw new Error('Silakan masuk dengan Google terlebih dahulu.');
    }

    const targetFolderId = folderId || (await ensureWarehouseFolder(activeToken));
    const metadata: Record<string, unknown> = {
      name: params.fileName,
      mimeType: params.mimeType,
    };
    if (!params.existingFileId) {
      metadata.parents = [targetFolderId];
    }

    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );
    form.append('file', params.contentBlob);

    const url = params.existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${params.existingFileId}?uploadType=multipart&fields=id,name,webViewLink,modifiedTime`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,modifiedTime';

    const res = await fetch(url, {
      method: params.existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${activeToken}`,
      },
      body: form,
    });

    if (res.status === 401) {
      setNeedsAuth(true);
      throw new Error('Sesi Google Drive telah berakhir. Silakan login ulang.');
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gagal mengunggah ke Google Drive: ${errText}`);
    }

    return res.json();
  };

  // Trigger sync of primary database file (checks if file already exists to ask confirmation before overwriting)
  const handleRequestSyncPrimaryDb = () => {
    const existingPrimary = driveFiles.find(
      (f) => f.name === PRIMARY_DB_FILENAME
    );
    if (existingPrimary) {
      setPendingAction({
        type: 'OVERWRITE_DB',
        title: `Perbarui File Cloud "${PRIMARY_DB_FILENAME}" di Google Drive?`,
        description: `Tindakan ini akan memperbarui isi file "${PRIMARY_DB_FILENAME}" di Google Drive dengan ${items.length} data Master Barang dan ${transactions.length} Log Transaksi terbaru.`,
        confirmLabel: 'Ya, Perbarui File di Google Drive',
        targetFile: existingPrimary,
      });
    } else {
      executeSyncPrimaryDb(undefined);
    }
  };

  const executeSyncPrimaryDb = async (existingFileId?: string) => {
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const jsonString = buildDatabasePayload();
      const blob = new Blob([jsonString], { type: 'application/json' });
      await uploadMultipartToDrive({
        fileName: PRIMARY_DB_FILENAME,
        mimeType: 'application/json',
        contentBlob: blob,
        existingFileId,
      });
      await loadDriveWorkspace();
      setStatusMessage({
        type: 'SUCCESS',
        text: `Database utama "${PRIMARY_DB_FILENAME}" (${items.length} Barang & ${transactions.length} Log) berhasil disimpan ke Google Drive (${TARGET_DRIVE_EMAIL}).`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'ERROR',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal menyimpan database ke Google Drive.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Create a new timestamped JSON snapshot backup in Google Drive
  const handleCreateNewJsonSnapshot = async () => {
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const stamp = new Date()
        .toTimeString()
        .slice(0, 8)
        .replace(/:/g, '');
      const fileName = `MME_Backup_Gudang_${formatLedgerDate()}_${stamp}.json`;
      const jsonString = buildDatabasePayload();
      const blob = new Blob([jsonString], { type: 'application/json' });

      await uploadMultipartToDrive({
        fileName,
        mimeType: 'application/json',
        contentBlob: blob,
      });
      await loadDriveWorkspace();
      setStatusMessage({
        type: 'SUCCESS',
        text: `File backup baru "${fileName}" berhasil dibuat di Google Drive.`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'ERROR',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal membuat snapshot backup di Google Drive.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Save full Excel Workbook (.xlsx) directly to Google Drive
  const handleUploadExcelToDrive = async () => {
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const wb = XLSX.utils.book_new();

      const itemHeaders = [
        'No',
        'Code Item',
        'Code Rak',
        'Type Code',
        'Model Unit',
        'Part Number',
        'Part Name',
        'Code Unit',
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
        'MIN',
        'MAX',
        'REMARK',
        'Moving Status',
        'Price (Rp)',
        'Total (Rp)',
      ];

      const itemRows = items.map((i) => [
        i.no,
        i.codeItem,
        i.rak,
        i.typeCode,
        i.modelUnit,
        i.partNumber,
        i.partName,
        i.codeUnit,
        formatDateDdMmmmYy(i.tanggalUpdate),
        formatDateDdMmmmYy(i.tanggalMasuk),
        formatDateDdMmmmYy(i.tanggalKeluar),
        i.supplier,
        i.brand,
        i.awalQty,
        i.unit,
        i.inQty,
        i.adjPlusQty,
        i.outQty,
        i.adjMinusQty,
        i.akhirQty,
        i.minQty,
        i.maxQty,
        i.remark,
        i.movementStatus,
        i.price,
        i.totalValue,
      ]);

      const wsItems = XLSX.utils.aoa_to_sheet([
        ['PT. MEGA MULTI ENERGI - DATABASE MASTER GUDANG (AUTHOR: IRAWAN)'],
        [`Disimpan ke Google Drive (${TARGET_DRIVE_EMAIL}) pada ${formatLedgerDate()}`],
        [],
        itemHeaders,
        ...itemRows,
      ]);
      XLSX.utils.book_append_sheet(wb, wsItems, 'Master_Barang');

      const txHeaders = [
        'No',
        'Tanggal',
        'Tipe Transaksi',
        'Code Item',
        'Rak',
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

      const txRows = transactions.map((tx, idx) => {
        const { officer, recipient } = splitPicAndRecipient(tx);
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
          tx.unitRef,
          officer,
          tx.notes,
        ];
      });

      const wsTx = XLSX.utils.aoa_to_sheet([
        ['PT. MEGA MULTI ENERGI - LOG TRANSAKSI HARIAN (AUTHOR: IRAWAN)'],
        [],
        txHeaders,
        ...txRows,
      ]);
      XLSX.utils.book_append_sheet(wb, wsTx, 'Log_Transaksi_Harian');

      const wbBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const excelBlob = new Blob([wbBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const stamp = new Date()
        .toTimeString()
        .slice(0, 5)
        .replace(/:/g, '');
      const excelFileName = `Laporan_Gudang_MME_${formatLedgerDate()}_${stamp}.xlsx`;

      await uploadMultipartToDrive({
        fileName: excelFileName,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentBlob: excelBlob,
      });

      await loadDriveWorkspace();
      setStatusMessage({
        type: 'SUCCESS',
        text: `Laporan Excel "${excelFileName}" (${formatRupiah(
          items.reduce((s, i) => s + i.totalValue, 0)
        )}) berhasil disimpan ke Google Drive (${TARGET_DRIVE_EMAIL}).`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'ERROR',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal mengunggah file Excel ke Google Drive.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Execute confirmed Restore from Google Drive JSON file
  const executeRestoreFile = async (file: DriveFileItem) => {
    const activeToken = await getAccessToken();
    if (!activeToken) {
      setNeedsAuth(true);
      return;
    }

    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        {
          headers: { Authorization: `Bearer ${activeToken}` },
        }
      );

      if (res.status === 401) {
        setNeedsAuth(true);
        throw new Error('Sesi Google Drive berakhir. Silakan login kembali.');
      }

      if (!res.ok) {
        throw new Error(`Gagal mengunduh file "${file.name}" dari Google Drive.`);
      }

      const parsed = await res.json();
      if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error(
          'Format file JSON tidak valid atau bukan file backup database PT. Mega Multi Energi.'
        );
      }

      await onRestoreFromDrive({
        items: parsed.items,
        transactions: Array.isArray(parsed.transactions)
          ? parsed.transactions
          : [],
        fileName: file.name,
      });

      setStatusMessage({
        type: 'SUCCESS',
        text: `Berhasil memulihkan ${parsed.items.length} barang dan ${
          Array.isArray(parsed.transactions) ? parsed.transactions.length : 0
        } log transaksi dari file Google Drive "${file.name}".`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'ERROR',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal memulihkan data dari Google Drive.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Execute confirmed Delete file from Google Drive
  const executeDeleteDriveFile = async (file: DriveFileItem) => {
    const activeToken = await getAccessToken();
    if (!activeToken) {
      setNeedsAuth(true);
      return;
    }

    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${activeToken}` },
        }
      );

      if (res.status === 401) {
        setNeedsAuth(true);
        throw new Error('Sesi Google Drive berakhir. Silakan login kembali.');
      }

      if (!res.ok) {
        throw new Error(`Gagal menghapus file "${file.name}" dari Google Drive.`);
      }

      await loadDriveWorkspace();
      setStatusMessage({
        type: 'SUCCESS',
        text: `File "${file.name}" telah dihapus dari Google Drive.`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'ERROR',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal menghapus file dari Google Drive.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);

    if (action.type === 'OVERWRITE_DB' && action.targetFile) {
      await executeSyncPrimaryDb(action.targetFile.id);
    } else if (action.type === 'DELETE_FILE' && action.targetFile) {
      await executeDeleteDriveFile(action.targetFile);
    } else if (action.type === 'RESTORE_FILE' && action.targetFile) {
      await executeRestoreFile(action.targetFile);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-6 shadow-2xl my-8 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-slate-100">
                  Penyimpanan Cloud Google Drive — PT. Mega Multi Energi
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[11px] font-mono font-bold text-amber-300">
                  {TARGET_DRIVE_EMAIL}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Simpan, cadangkan (backup), dan pulihkan database Master Barang & Log Transaksi langsung di Google Drive • Author: <strong className="text-slate-200">Irawan</strong>
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

        {/* Account Status & Official Google Sign-In Section */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-slate-200">
                Target Akun Penyimpanan Google Drive:
              </span>
              <span className="font-mono text-xs font-bold text-amber-400">
                {TARGET_DRIVE_EMAIL}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {token && !needsAuth ? (
                <>
                  Status: <strong className="text-emerald-400">Terhubung</strong> sebagai{' '}
                  <span className="font-mono text-slate-200">
                    {driveUser?.email || TARGET_DRIVE_EMAIL}
                  </span>{' '}
                  • Folder Drive:{' '}
                  <span className="font-mono text-cyan-300">{DRIVE_FOLDER_NAME}</span>
                </>
              ) : (
                'Silakan masuk dengan akun Google (sebelasirawan@gmail.com) untuk mengaktifkan penyimpanan langsung ke Google Drive.'
              )}
            </p>
          </div>

          {(needsAuth || !token) ? (
            <button
              type="button"
              disabled={isLoggingIn}
              onClick={handleLogin}
              className="gsi-material-button inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs shadow-md transition cursor-pointer disabled:opacity-50"
            >
              <div className="gsi-material-button-icon w-4 h-4 shrink-0">
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  style={{ display: 'block' }}
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                  <path fill="none" d="M0 0h48v48H0z" />
                </svg>
              </div>
              <span className="gsi-material-button-contents">
                {isLoggingIn ? 'Menghubungkan...' : 'Sign in with Google'}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadDriveWorkspace()}
                disabled={isLoadingFiles || isProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`}
                />
                Segarkan Drive
              </button>
              <button
                type="button"
                onClick={handleLogin}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-300 cursor-pointer"
              >
                Ganti / Perbarui Sesi Akun
              </button>
            </div>
          )}
        </div>

        {/* Status Message Banner */}
        {statusMessage && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
              statusMessage.type === 'SUCCESS'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : statusMessage.type === 'ERROR'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
            }`}
          >
            {statusMessage.type === 'SUCCESS' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <span className="flex-1">{statusMessage.text}</span>
          </div>
        )}

        {/* Cloud Save Actions (Enabled once authenticated with Google Drive) */}
        {token && !needsAuth && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {/* Action 1: Sync Primary Cloud Database JSON */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono text-[10px] font-bold">
                      SINKRONISASI UTAMA
                    </span>
                    <FileJson className="w-4 h-4 text-amber-400" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-100">
                    Simpan Database Cloud Utama
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Menyimpan <strong>{items.length} Barang</strong> &{' '}
                    <strong>{transactions.length} Log</strong> ke file utama{' '}
                    <span className="font-mono text-amber-300">
                      {PRIMARY_DB_FILENAME}
                    </span>{' '}
                    di Google Drive.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleRequestSyncPrimaryDb}
                  className="mt-4 w-full py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <UploadCloud className="w-4 h-4" />
                  Simpan ke Database Drive
                </button>
              </div>

              {/* Action 2: Upload Full Excel Report (.xlsx) to Google Drive */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[10px] font-bold">
                      SPREADSHEET EXCEL (.XLSX)
                    </span>
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-100">
                    Simpan Laporan Excel ke Drive
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Buat dan unggah langsung file Excel (Sheet Master Barang + Sheet Log Transaksi) ke Google Drive Anda.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleUploadExcelToDrive}
                  className="mt-4 w-full py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Upload Excel ke Google Drive
                </button>
              </div>

              {/* Action 3: Create New Dated Snapshot JSON */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono text-[10px] font-bold">
                      ARSIP SNAPSHOT HARIAN
                    </span>
                    <FolderOpen className="w-4 h-4 text-cyan-400" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-100">
                    Buat Cadangan Baru Bertanggal
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Simpan salinan arsip baru dengan nama tanggal hari ini ({formatLedgerDate()}) tanpa menimpa file sebelumnya.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleCreateNewJsonSnapshot}
                  className="mt-4 w-full py-2 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <UploadCloud className="w-4 h-4" />
                  Buat Arsip Baru di Drive
                </button>
              </div>
            </div>

            {/* List of Files in Google Drive Folder */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                  File Tersimpan di Google Drive ({driveFiles.length} File)
                </h4>
                <span className="text-[11px] font-mono text-slate-400">
                  Folder: /{DRIVE_FOLDER_NAME}
                </span>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                {isLoadingFiles ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Memuat daftar file dari Google Drive...
                  </div>
                ) : driveFiles.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Belum ada file tersimpan di folder Google Drive ini. Klik tombol <strong>Simpan ke Database Drive</strong> atau <strong>Upload Excel ke Google Drive</strong> di atas.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Nama File di Google Drive</th>
                          <th className="py-2.5 px-3">Tipe</th>
                          <th className="py-2.5 px-3">Waktu Modifikasi</th>
                          <th className="py-2.5 px-3 text-right">Aksi Cloud</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {driveFiles.map((file) => {
                          const isJson =
                            file.mimeType.includes('json') ||
                            file.name.endsWith('.json');
                          return (
                            <tr key={file.id} className="hover:bg-slate-900/60">
                              <td className="py-2.5 px-3 font-mono font-semibold text-slate-200">
                                <div className="flex items-center gap-2">
                                  {isJson ? (
                                    <FileJson className="w-4 h-4 text-amber-400 shrink-0" />
                                  ) : (
                                    <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                                  )}
                                  <span>{file.name}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                                {isJson ? 'Database JSON' : 'Excel (.xlsx)'}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                                {file.modifiedTime
                                  ? new Date(file.modifiedTime).toLocaleString('id-ID')
                                  : '-'}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {file.webViewLink && (
                                    <a
                                      href={file.webViewLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      Buka di Drive
                                    </a>
                                  )}

                                  {isJson && (
                                    <button
                                      type="button"
                                      disabled={isProcessing}
                                      onClick={() =>
                                        setPendingAction({
                                          type: 'RESTORE_FILE',
                                          title: `Pulihkan Data Gudang dari "${file.name}"?`,
                                          description: `Data Master Barang dan Log Transaksi di aplikasi saat ini akan digantikan dengan data dari file Google Drive "${file.name}".`,
                                          confirmLabel: 'Ya, Pulihkan Data Ini',
                                          targetFile: file,
                                        })
                                      }
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-[11px] font-bold transition cursor-pointer"
                                    >
                                      <DownloadCloud className="w-3 h-3" />
                                      Pulihkan (Restore)
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    disabled={isProcessing}
                                    onClick={() =>
                                      setPendingAction({
                                        type: 'DELETE_FILE',
                                        title: `Hapus File "${file.name}" dari Google Drive?`,
                                        description: `Apakah Anda yakin ingin menghapus file "${file.name}" secara permanen dari folder Google Drive (${TARGET_DRIVE_EMAIL})? Tindakan ini tidak dapat dibatalkan.`,
                                        confirmLabel: 'Ya, Hapus dari Google Drive',
                                        targetFile: file,
                                      })
                                    }
                                    className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 transition cursor-pointer"
                                    title="Hapus file dari Google Drive"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Mandatory Explicit User Confirmation Dialog for Mutating/Destructive Google Drive Operations */}
        {pendingAction && (
          <div className="p-4 rounded-xl bg-slate-950 border-2 border-amber-500 space-y-3 shadow-xl">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h5 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  {pendingAction.title}
                </h5>
                <p className="text-xs text-slate-300 mt-1">
                  {pendingAction.description}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmPendingAction}
                className={`px-4 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer ${
                  pendingAction.type === 'DELETE_FILE'
                    ? 'bg-rose-500 hover:bg-rose-400 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                {pendingAction.confirmLabel}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs text-slate-400">
          <span>
            Google Drive Cloud • Akun Tujuan: <strong className="text-slate-200">{TARGET_DRIVE_EMAIL}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
