import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { QRCodeSVG } from 'qrcode.react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Upload,
  QrCode,
  ArrowDownLeft,
  ArrowUpRight,
  SlidersHorizontal,
  AlertTriangle,
  Sparkles,
  Package,
  MapPin,
  Hash,
  User,
  UserCheck,
  Wrench,
  FileText,
  Truck,
  Volume2,
  VolumeX,
  Keyboard,
  Layers,
} from 'lucide-react';
import {
  InventoryItem,
  TransactionType,
  QrPayloadMode,
  calculateAkhirQty,
  calculateRemark,
  encodeItemQrPayload,
  formatRupiah,
  resolveScannedItems,
  ITEM_TYPE_LABELS,
} from '../types/warehouse';

interface QrScannerPanelProps {
  items: InventoryItem[];
  preselectedCode?: string | null;
  onClearPreselected?: () => void;
  onSubmitTransaction: (params: {
    codeItem: string;
    txType: TransactionType;
    qty: number;
    picName: string;
    recipientName: string;
    unitRef: string;
    notes: string;
    source: 'QR_SCANNER' | 'MANUAL_ADMIN';
  }) => Promise<void>;
}

function playScanBeep(success = true) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'sawtooth';
    osc.frequency.setValueAtTime(success ? 1046.5 : 240, ctx.currentTime);
    if (success) {
      osc.frequency.exponentialRampToValueAtTime(1567.98, ctx.currentTime + 0.09);
    }
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.17);
  } catch {
    // Ignore audio context restriction
  }
}

export const QrScannerPanel: React.FC<QrScannerPanelProps> = ({
  items,
  preselectedCode,
  onClearPreselected,
  onSubmitTransaction,
}) => {
  const [scanMode, setScanMode] = useState<'CAMERA' | 'HARDWARE_GUN' | 'SIMULATOR'>('CAMERA');
  const [simulatorKeyType, setSimulatorKeyType] = useState<'PART_NUMBER' | 'ITEM_CODE' | 'RAK'>('PART_NUMBER');
  const [simulatorSearch, setSimulatorSearch] = useState<string>('');
  const [previewQrType, setPreviewQrType] = useState<QrPayloadMode>('PART_NUMBER');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [rawScanInput, setRawScanInput] = useState<string>('');
  const [scannedCode, setScannedCode] = useState<string>('');
  const [matchedByType, setMatchedByType] = useState<'CODE_ITEM' | 'PART_NUMBER' | 'RAK' | 'NONE'>('NONE');
  const [scannedTokenLabel, setScannedTokenLabel] = useState<string>('');
  const [candidateItems, setCandidateItems] = useState<InventoryItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  // Transaction form state
  const [txType, setTxType] = useState<TransactionType>('OUT');
  const [qty, setQty] = useState<number>(1);
  const [picName, setPicName] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [unitRef, setUnitRef] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastSuccessMsg, setLastSuccessMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hardwareInputRef = useRef<HTMLInputElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const matchedItem = items.find(
    (item) => item.codeItem.toUpperCase() === scannedCode.toUpperCase()
  );

  // Handle preselected item or QR payload passed from Dashboard or QR Label Studio
  useEffect(() => {
    if (preselectedCode) {
      handleDetectedCode(preselectedCode);
      if (onClearPreselected) onClearPreselected();
    }
  }, [preselectedCode]);

  const handleDetectedCode = (rawText: string) => {
    const result = resolveScannedItems(rawText, items);
    if (!rawText.trim()) return;

    if (result.items.length > 0) {
      const primary = result.items[0];
      setScannedCode(primary.codeItem);
      setMatchedByType(result.matchedBy);
      setScannedTokenLabel(result.scannedToken);
      setCandidateItems(result.items);
      setRawScanInput(
        result.matchedBy === 'PART_NUMBER'
          ? `PN:${primary.partNumber}`
          : result.matchedBy === 'RAK'
          ? `RAK:${primary.rak}`
          : primary.codeItem
      );
      setPreviewQrType(
        result.matchedBy === 'PART_NUMBER'
          ? 'PART_NUMBER'
          : result.matchedBy === 'RAK'
          ? 'RAK'
          : 'ITEM_CODE'
      );
      setScanError(null);
      setUnitRef(primary.codeUnit || primary.modelUnit);
      if (soundEnabled) playScanBeep(true);
    } else {
      setScannedCode('');
      setMatchedByType('NONE');
      setCandidateItems([]);
      setScanError(
        `Kode QR / Input "${rawText.trim()}" tidak ditemukan. Anda dapat memindai atau mengetik Code Item (DPS-2105), Part Number (ZMME-0000203 / 15601-E0240), atau Kode Rak (101A01).`
      );
      if (soundEnabled) playScanBeep(false);
    }
  };

  // Camera lifecycle
  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      if (!cameraActive) return;
      setCameraError(null);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play();
          requestAnimationFrame(tickScan);
        }
      } catch {
        setCameraError(
          'Kamera tidak dapat diakses pada perangkat/browser ini. Gunakan mode "Simulasi Scan Cepat", "Upload Gambar QR", atau "Scanner Fisik USB".'
        );
        setCameraActive(false);
      }
    };

    const tickScan = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (qr && qr.data) {
            handleDetectedCode(qr.data);
            setCameraActive(false);
            return;
          }
        }
      }
      if (cameraActive) {
        animFrameRef.current = requestAnimationFrame(tickScan);
      }
    };

    if (cameraActive) {
      startCamera();
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraActive]);

  // Decode uploaded QR code image
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height);
        if (qr && qr.data) {
          handleDetectedCode(qr.data);
        } else {
          setScanError('Gambar tidak mengandung QR Code yang terbaca. Coba gambar QR yang lebih jelas.');
          if (soundEnabled) playScanBeep(false);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Calculate projected stock after transaction
  const projectedAkhirQty = matchedItem
    ? calculateAkhirQty(
        matchedItem.awalQty,
        matchedItem.inQty + (txType === 'IN' ? qty : 0),
        matchedItem.adjPlusQty + (txType === 'ADJ_PLUS' ? qty : 0),
        matchedItem.outQty + (txType === 'OUT' ? qty : 0),
        matchedItem.adjMinusQty + (txType === 'ADJ_MINUS' ? qty : 0)
      )
    : 0;

  const isInsufficientStock =
    matchedItem &&
    (txType === 'OUT' || txType === 'ADJ_MINUS') &&
    qty > matchedItem.akhirQty;

  const projectedRemark = matchedItem
    ? calculateRemark(projectedAkhirQty, matchedItem.minQty, matchedItem.maxQty)
    : 'AMAN';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedItem || qty < 1 || isInsufficientStock) return;

    setIsSubmitting(true);
    try {
      await onSubmitTransaction({
        codeItem: matchedItem.codeItem,
        txType,
        qty,
        picName: picName.trim(),
        recipientName:
          txType === 'OUT' || txType === 'ADJ_MINUS'
            ? recipientName.trim() || 'Mekanik Operasional'
            : recipientName.trim(),
        unitRef: unitRef.trim() || matchedItem.codeUnit,
        notes:
          notes.trim() ||
          `Transaksi ${txType} via QR Scanner (${
            matchedByType === 'PART_NUMBER'
              ? `PN: ${matchedItem.partNumber}`
              : matchedByType === 'RAK'
              ? `Rak: ${matchedItem.rak}`
              : matchedItem.codeItem
          } - ${matchedItem.partName})`,
        source: 'QR_SCANNER',
      });
      if (soundEnabled) playScanBeep(true);
      setLastSuccessMsg(
        `Berhasil! ${
          txType === 'IN'
            ? 'Pemasukan (+)'
            : txType === 'OUT'
            ? 'Pengeluaran (-)'
            : txType === 'ADJ_PLUS'
            ? 'Penyesuaian (+)'
            : 'Penyesuaian (-)'
        } ${qty} ${matchedItem.unit} untuk [${matchedItem.codeItem} | PN: ${
          matchedItem.partNumber
        }] ${matchedItem.partName} telah tersinkronisasi ke Dashboard Admin.`
      );
      setQty(1);
      setPicName('');
      setRecipientName('');
      setNotes('');
      setTimeout(() => setLastSuccessMsg(null), 6000);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: QR Scanner Viewport & Multi-Mode Input */}
      <div className="lg:col-span-5 flex flex-col gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <QrCode className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">Terminal Scanner QR Gudang</h2>
                <p className="text-xs text-slate-400">
                  Mendukung Scan <span className="text-cyan-300 font-semibold">QR Part Number</span>,{' '}
                  <span className="text-amber-300 font-semibold">Code Item</span>, atau{' '}
                  <span className="text-emerald-300 font-semibold">Kode Rak</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
              title={soundEnabled ? 'Suara Beep Aktif' : 'Suara Beep Nonaktif'}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-500" />
              )}
            </button>
          </div>

          {/* Supported QR Badges */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5 bg-slate-950/90 border border-slate-800/80 rounded-lg px-3 py-2 text-[11px]">
            <span className="text-slate-400 font-medium">Mode Identifikasi Aktif:</span>
            <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 font-mono font-bold text-cyan-300 flex items-center gap-1">
              <Hash className="w-3 h-3" /> Part Number
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 font-mono font-bold text-amber-300 flex items-center gap-1">
              <QrCode className="w-3 h-3" /> Code Item
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 font-mono font-bold text-emerald-300 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Kode Rak
            </span>
          </div>

          {/* Scanner Mode Selector */}
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800 mb-4">
            <button
              type="button"
              onClick={() => setScanMode('CAMERA')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                scanMode === 'CAMERA'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              Kamera Live
            </button>
            <button
              type="button"
              onClick={() => {
                setCameraActive(false);
                setScanMode('HARDWARE_GUN');
                setTimeout(() => hardwareInputRef.current?.focus(), 80);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                scanMode === 'HARDWARE_GUN'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              Scanner USB
            </button>
            <button
              type="button"
              onClick={() => {
                setCameraActive(false);
                setScanMode('SIMULATOR');
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                scanMode === 'SIMULATOR'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Simulasi Cepat
            </button>
          </div>

          {/* Mode 1: Camera Live Viewfinder */}
          {scanMode === 'CAMERA' && (
            <div className="space-y-3">
              <div className="relative aspect-4/3 w-full bg-slate-950 rounded-xl border border-slate-800 overflow-hidden flex items-center justify-center">
                {cameraActive ? (
                  <>
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    {/* Targeting Frame & Laser Scanline */}
                    <div className="absolute inset-8 border-2 border-amber-400/60 rounded-xl pointer-events-none">
                      <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
                      <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
                      <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
                      <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />
                      <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_12px_#f59e0b] animate-scanline" />
                    </div>
                    <div className="absolute bottom-3 left-3 right-3 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
                      <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                        Mendeteksi QR Part Number / Item / Rak...
                      </span>
                      <span className="text-cyan-300 font-mono">PN / DPS / RAK</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center p-6">
                    <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-amber-400">
                      <Camera className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-semibold text-slate-200 mb-1">
                      Kamera Pemindai Multi-QR Siap
                    </p>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto mb-4">
                      Arahkan kamera ke label <strong>QR Part Number</strong>, <strong>QR Code Item</strong>, atau <strong>QR Kode Rak</strong> pada barang/rak gudang.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCameraActive(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
                      >
                        <Camera className="w-4 h-4" />
                        Aktifkan Kamera QR
                      </button>
                      <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition cursor-pointer">
                        <Upload className="w-4 h-4 text-amber-400" />
                        Upload Gambar QR
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {cameraActive && (
                <button
                  type="button"
                  onClick={() => setCameraActive(false)}
                  className="w-full py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <CameraOff className="w-4 h-4" />
                  Matikan Kamera
                </button>
              )}

              {cameraError && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>{cameraError}</span>
                </div>
              )}
            </div>
          )}

          {/* Mode 2: Hardware Barcode/QR Gun Input */}
          {scanMode === 'HARDWARE_GUN' && (
            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                  Mode Scanner Fisik (USB / Bluetooth 2D)
                </span>
                <span className="text-[11px] font-mono text-emerald-400">Auto-Enter Ready</span>
              </div>
              <p className="text-xs text-slate-400">
                Tembakkan alat scanner ke <strong>QR Part Number</strong> (cth: <code className="text-cyan-300">ZMME-0000203</code>), <strong>Code Item</strong> (<code className="text-amber-300">DPS-2105</code>), atau <strong>Kode Rak</strong> (<code className="text-emerald-300">101A01</code>).
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleDetectedCode(rawScanInput);
                }}
                className="flex gap-2"
              >
                <input
                  ref={hardwareInputRef}
                  type="text"
                  value={rawScanInput}
                  onChange={(e) => setRawScanInput(e.target.value)}
                  placeholder="Scan/ketik Part Number, DPS-2105, atau Rak..."
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-lg px-3.5 py-2.5 text-sm font-mono text-slate-100 outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
                >
                  Cari
                </button>
              </form>
            </div>
          )}

          {/* Mode 3: Quick QR Simulator (1-Click Scan by Part Number / Code Item / Kode Rak) */}
          {scanMode === 'SIMULATOR' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-300">
                  Pilih Jenis QR Simulasi Scan:
                </span>
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSimulatorKeyType('PART_NUMBER')}
                    className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                      simulatorKeyType === 'PART_NUMBER'
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    QR Part Number
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimulatorKeyType('ITEM_CODE')}
                    className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                      simulatorKeyType === 'ITEM_CODE'
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    QR Code Item
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimulatorKeyType('RAK')}
                    className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                      simulatorKeyType === 'RAK'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    QR Kode Rak
                  </button>
                </div>
              </div>

              <input
                type="text"
                value={simulatorSearch}
                onChange={(e) => setSimulatorSearch(e.target.value)}
                placeholder={`Filter dari ${items.length.toLocaleString('id-ID')} barang (Code Item, PN, Rak, Nama)...`}
                className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg px-3 py-1.5 text-xs text-slate-100 outline-none"
              />

              <div className="max-h-64 overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {items
                  .filter((item) => {
                    const q = simulatorSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      item.codeItem.toLowerCase().includes(q) ||
                      item.partNumber.toLowerCase().includes(q) ||
                      item.partName.toLowerCase().includes(q) ||
                      item.rak.toLowerCase().includes(q)
                    );
                  })
                  .slice(0, 60)
                  .map((item) => {
                  const isSelected = item.codeItem === scannedCode;
                  const payloadToScan =
                    simulatorKeyType === 'PART_NUMBER'
                      ? `PN:${item.partNumber}`
                      : simulatorKeyType === 'RAK'
                      ? `RAK:${item.rak}`
                      : item.codeItem;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleDetectedCode(payloadToScan)}
                      className={`text-left p-2.5 rounded-lg border transition flex items-start justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                          : 'bg-slate-950 hover:bg-slate-800/80 border-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {simulatorKeyType === 'PART_NUMBER' ? (
                            <span className="font-mono text-xs font-bold text-cyan-400 truncate">
                              PN: {item.partNumber}
                            </span>
                          ) : simulatorKeyType === 'RAK' ? (
                            <span className="font-mono text-xs font-bold text-emerald-400">
                              RAK: {item.rak}
                            </span>
                          ) : (
                            <span className="font-mono text-xs font-bold text-amber-400">
                              {item.codeItem}
                            </span>
                          )}
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                            {simulatorKeyType === 'PART_NUMBER' ? item.codeItem : item.rak}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-200 truncate mt-0.5">
                          {item.partName}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-bold text-slate-100">
                          {item.akhirQty}
                        </span>
                        <span className="block text-[10px] text-slate-500">{item.unit}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Always-accessible Quick Multi-Code Lookup Bar */}
          {scanMode !== 'HARDWARE_GUN' && (
            <div className="mt-4 pt-4 border-t border-slate-800">
              <label className="block text-[11px] text-slate-400 mb-1.5">
                Ketik / Paste <strong>Part Number</strong>, <strong>Code Item</strong>, atau <strong>Kode Rak</strong>:
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleDetectedCode(rawScanInput);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={rawScanInput}
                  onChange={(e) => setRawScanInput(e.target.value)}
                  placeholder="Cth: ZMME-0000203 atau DPS-2105 atau 101A01..."
                  className="flex-1 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 outline-none"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  Cari QR
                </button>
              </form>
            </div>
          )}

          {scanError && (
            <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{scanError}</span>
            </div>
          )}
        </div>

        {/* Interactive QR Code Preview Card for Currently Selected Item (Part Number / Code Item / Rak) */}
        {matchedItem && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  QR Code Barang Terpilih (Opsional Scan)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Pilih jenis QR di bawah untuk melihat QR Part Number, Code Item, atau Rak
                </p>
              </div>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setPreviewQrType('PART_NUMBER')}
                  className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                    previewQrType === 'PART_NUMBER'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Part Number
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewQrType('ITEM_CODE')}
                  className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                    previewQrType === 'ITEM_CODE'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Code Item
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewQrType('RAK')}
                  className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                    previewQrType === 'RAK'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Kode Rak
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="bg-white p-2 rounded-lg shrink-0 border-2 border-slate-200">
                <QRCodeSVG
                  value={encodeItemQrPayload(matchedItem, previewQrType)}
                  size={84}
                  level="M"
                  includeMargin={false}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      previewQrType === 'PART_NUMBER'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : previewQrType === 'RAK'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {previewQrType === 'PART_NUMBER'
                      ? 'QR PART NUMBER'
                      : previewQrType === 'RAK'
                      ? 'QR KODE RAK'
                      : 'QR CODE ITEM'}
                  </span>
                </div>
                <p className="text-xs font-mono font-bold text-slate-100 truncate">
                  Payload: {encodeItemQrPayload(matchedItem, previewQrType)}
                </p>
                <p className="text-[11px] text-slate-400">
                  PN: <strong className="text-cyan-300 font-mono">{matchedItem.partNumber}</strong> • Item:{' '}
                  <strong className="text-amber-300 font-mono">{matchedItem.codeItem}</strong> • Rak:{' '}
                  <strong className="text-emerald-300 font-mono">{matchedItem.rak}</strong>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Scanned Item Details & Daily IN/OUT Execution Form */}
      <div className="lg:col-span-7">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg h-full flex flex-col justify-between">
          {lastSuccessMsg && (
            <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-emerald-300 text-sm">Sinkronisasi Real-Time Berhasil</p>
                <p className="mt-0.5">{lastSuccessMsg}</p>
              </div>
            </div>
          )}

          {!matchedItem ? (
            <div className="my-auto py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto mb-4 text-slate-500">
                <QrCode className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-200">
                Belum Ada Barang yang Dipindai
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
                Silakan pindai <strong>QR Part Number</strong>, <strong>QR Code Item</strong>, atau <strong>QR Kode Rak</strong> untuk mencatat Pemasukan (IN) maupun Pengeluaran (OUT) harian.
              </p>

              {/* Quick Test Buttons for Part Number, Code Item, and Kode Rak */}
              <div className="max-w-lg mx-auto space-y-3">
                <div>
                  <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider block mb-1.5">
                    Contoh Scan via QR Part Number (Opsional):
                  </span>
                  <div className="flex flex-wrap justify-center gap-2">
                    {items.slice(0, 4).map((sample) => (
                      <button
                        key={`pn-${sample.id}`}
                        type="button"
                        onClick={() => handleDetectedCode(`PN:${sample.partNumber}`)}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-xs font-mono text-cyan-300 transition cursor-pointer flex items-center gap-1.5"
                      >
                        <Hash className="w-3.5 h-3.5" />
                        PN: {sample.partNumber} ({sample.partName})
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-mono text-amber-400 uppercase tracking-wider block mb-1.5">
                    Contoh Scan via Code Item / Kode Rak:
                  </span>
                  <div className="flex flex-wrap justify-center gap-2">
                    {items.slice(0, 3).map((sample) => (
                      <button
                        key={`code-${sample.id}`}
                        type="button"
                        onClick={() => handleDetectedCode(sample.codeItem)}
                        className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-amber-400 transition cursor-pointer"
                      >
                        {sample.codeItem} (Rak {sample.rak})
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Multi-item chooser if a scanned Kode Rak or Part Number has >1 item */}
              {candidateItems.length > 1 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-amber-300 flex items-center gap-1.5">
                      <Layers className="w-4 h-4" />
                      Terdapat {candidateItems.length} Barang pada{' '}
                      {matchedByType === 'RAK'
                        ? `Rak ${scannedTokenLabel}`
                        : `Part Number ${scannedTokenLabel}`}{' '}
                      — Pilih Barang:
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {candidateItems.map((cand) => (
                      <button
                        key={cand.id}
                        type="button"
                        onClick={() => {
                          setScannedCode(cand.codeItem);
                          setUnitRef(cand.codeUnit || cand.modelUnit);
                        }}
                        className={`px-2.5 py-1.5 rounded-lg font-mono text-xs font-bold transition cursor-pointer ${
                          cand.codeItem === matchedItem.codeItem
                            ? 'bg-amber-500 text-slate-950 shadow-sm'
                            : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-amber-500/50'
                        }`}
                      >
                        {cand.codeItem} • {cand.partName} (PN: {cand.partNumber})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Scanned Item Header Card */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 font-mono text-sm font-bold text-amber-300">
                        {matchedItem.codeItem}
                      </span>
                      <span className="px-2.5 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/40 font-mono text-xs font-bold text-cyan-300 flex items-center gap-1">
                        <Hash className="w-3.5 h-3.5" />
                        PN: {matchedItem.partNumber}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-xs flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-amber-400" />
                        Rak: {matchedItem.rak}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono text-xs">
                        {matchedItem.typeCode} ({ITEM_TYPE_LABELS[matchedItem.typeCode]?.desc})
                      </span>
                      {matchedByType !== 'NONE' && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[10px] font-bold">
                          Terdeteksi via{' '}
                          {matchedByType === 'PART_NUMBER'
                            ? 'QR Part Number'
                            : matchedByType === 'RAK'
                            ? 'QR Kode Rak'
                            : 'QR Code Item'}
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-slate-100 mt-2">
                      {matchedItem.partName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mt-1">
                      <span className="font-mono flex items-center gap-1 text-cyan-300">
                        <Hash className="w-3.5 h-3.5" />
                        Part Number: {matchedItem.partNumber}
                      </span>
                      <span className="flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5 text-slate-500" />
                        Unit: {matchedItem.modelUnit} ({matchedItem.codeUnit})
                      </span>
                      <span>Supplier: {matchedItem.supplier}</span>
                    </div>
                  </div>

                  {/* Current Stock Box */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-right">
                    <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                      Stok Akhir Saat Ini
                    </span>
                    <div className="flex items-baseline justify-end gap-1.5 mt-0.5">
                      <span className="text-2xl font-extrabold font-mono text-slate-100 tabular-nums">
                        {matchedItem.akhirQty}
                      </span>
                      <span className="text-xs text-slate-400 font-medium">{matchedItem.unit}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                      Min: {matchedItem.minQty} | Max: {matchedItem.maxQty}
                    </div>
                  </div>
                </div>

                {/* Mini Ledger Summary Row */}
                <div className="grid grid-cols-5 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-center">
                  <div className="bg-slate-900/70 rounded-lg p-1.5">
                    <span className="text-[10px] text-slate-400 block">Stok Awal</span>
                    <span className="font-mono text-xs font-bold text-slate-200">{matchedItem.awalQty}</span>
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg p-1.5">
                    <span className="text-[10px] text-emerald-400 block">Total IN</span>
                    <span className="font-mono text-xs font-bold text-emerald-300">{matchedItem.inQty}</span>
                  </div>
                  <div className="bg-blue-500/10 rounded-lg p-1.5">
                    <span className="text-[10px] text-blue-400 block">Adj (+)</span>
                    <span className="font-mono text-xs font-bold text-blue-300">{matchedItem.adjPlusQty}</span>
                  </div>
                  <div className="bg-rose-500/10 rounded-lg p-1.5">
                    <span className="text-[10px] text-rose-400 block">Total OUT</span>
                    <span className="font-mono text-xs font-bold text-rose-300">{matchedItem.outQty}</span>
                  </div>
                  <div className="bg-amber-500/10 rounded-lg p-1.5">
                    <span className="text-[10px] text-amber-400 block">Adj (-)</span>
                    <span className="font-mono text-xs font-bold text-amber-300">{matchedItem.adjMinusQty}</span>
                  </div>
                </div>
              </div>

              {/* Transaction Type Selector */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Pilih Jenis Transaksi Harian
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setTxType('IN')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      txType === 'IN'
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                      <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        MASUK
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-100">Barang Masuk (IN)</p>
                    <p className="text-[11px] text-slate-400">Penerimaan supplier</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTxType('OUT')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      txType === 'OUT'
                        ? 'bg-rose-500/15 border-rose-500 text-rose-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <ArrowUpRight className="w-4 h-4 text-rose-400" />
                      <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                        KELUAR
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-100">Barang Keluar (OUT)</p>
                    <p className="text-[11px] text-slate-400">Pemakaian unit/mekanik</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTxType('ADJ_PLUS')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      txType === 'ADJ_PLUS'
                        ? 'bg-blue-500/15 border-blue-500 text-blue-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <SlidersHorizontal className="w-4 h-4 text-blue-400" />
                      <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                        + ADJ
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-100">Penyesuaian (+)</p>
                    <p className="text-[11px] text-slate-400">Koreksi opname tambah</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTxType('ADJ_MINUS')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      txType === 'ADJ_MINUS'
                        ? 'bg-amber-500/15 border-amber-500 text-amber-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                      <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        - ADJ
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-100">Penyesuaian (-)</p>
                    <p className="text-[11px] text-slate-400">Koreksi opname kurang</p>
                  </button>
                </div>
              </div>

              {/* Quantity & Live Stock Projection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Jumlah Kuantitas ({matchedItem.unit})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQty(Math.max(1, qty - 1))}
                      className="w-10 h-10 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 font-mono font-bold text-lg text-slate-200 transition cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={qty}
                      onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full h-10 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg text-center font-mono text-base font-bold text-slate-100 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQty(qty + 1)}
                      className="w-10 h-10 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 font-mono font-bold text-lg text-slate-200 transition cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {[1, 2, 5, 10, 25].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setQty(preset)}
                        className="flex-1 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-300 transition cursor-pointer"
                      >
                        {preset} {matchedItem.unit}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Stock Impact Preview */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Simulasi Stok Akhir:</span>
                    <span
                      className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                        projectedRemark === 'ORDER'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : projectedRemark === 'AMAN'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      REMARK: {projectedRemark}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 my-1">
                    <span className="font-mono text-lg text-slate-400">{matchedItem.akhirQty}</span>
                    <span className="text-slate-500">→</span>
                    <span
                      className={`font-mono text-2xl font-extrabold ${
                        isInsufficientStock
                          ? 'text-rose-400'
                          : txType === 'IN' || txType === 'ADJ_PLUS'
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {isInsufficientStock ? 'Stok Kurang!' : `${projectedAkhirQty} ${matchedItem.unit}`}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Estimasi Nilai: {formatRupiah(projectedAkhirQty * matchedItem.price)}
                  </div>
                </div>
              </div>

              {/* Separated PIC Logistik, Nama Mekanik Pengambil, and Code Unit */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    PIC Logistik (Petugas Gudang)
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      maxLength={50}
                      value={picName}
                      onChange={(e) => setPicName(e.target.value)}
                      placeholder="Kosong (atau ketik nama PIC)..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {txType === 'OUT' || txType === 'ADJ_MINUS' ? (
                      <span className="text-rose-300 font-semibold">
                        Nama Mekanik Pengambil *
                      </span>
                    ) : (
                      <span>Nama Mekanik / Pengirim (Opsional)</span>
                    )}
                  </label>
                  <div className="relative">
                    {txType === 'OUT' || txType === 'ADJ_MINUS' ? (
                      <Wrench className="w-4 h-4 text-rose-400 absolute left-3 top-2.5" />
                    ) : (
                      <UserCheck className="w-4 h-4 text-emerald-400 absolute left-3 top-2.5" />
                    )}
                    <input
                      type="text"
                      required={txType === 'OUT' || txType === 'ADJ_MINUS'}
                      maxLength={50}
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder={
                        txType === 'OUT' || txType === 'ADJ_MINUS'
                          ? 'Nama mekanik pengambil...'
                          : 'Nama kurir / supplier pengirim...'
                      }
                      className={`w-full bg-slate-950 border rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 outline-none ${
                        txType === 'OUT' || txType === 'ADJ_MINUS'
                          ? 'border-rose-500/40 focus:border-rose-400'
                          : 'border-slate-800 focus:border-emerald-500'
                      }`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Code Unit (Unit Alat / No. WO)
                  </label>
                  <div className="relative">
                    <Package className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      maxLength={100}
                      value={unitRef}
                      onChange={(e) => setUnitRef(e.target.value)}
                      placeholder="Cth: Water Pump / HINO 500 / LV-09"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Keterangan / Keperluan Harian
                </label>
                <div className="relative">
                  <FileText className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    maxLength={300}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Catatan pemakaian sparepart atau surat jalan supplier..."
                    className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
              </div>

              {isInsufficientStock && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>
                    Stok akhir saat ini hanya <strong>{matchedItem.akhirQty} {matchedItem.unit}</strong>. Tidak dapat mengeluarkan {qty} {matchedItem.unit}.
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || Boolean(isInsufficientStock)}
                className={`w-full py-3 px-5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  txType === 'IN'
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                    : txType === 'OUT'
                    ? 'bg-rose-500 hover:bg-rose-400 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                <QrCode className="w-4 h-4" />
                {isSubmitting
                  ? 'Menyinkronkan ke Dashboard...'
                  : `Konfirmasi ${
                      txType === 'IN'
                        ? 'Barang Masuk (+IN)'
                        : txType === 'OUT'
                        ? 'Barang Keluar (-OUT)'
                        : txType === 'ADJ_PLUS'
                        ? 'Penyesuaian (+)'
                        : 'Penyesuaian (-)'
                    } • ${qty} ${matchedItem.unit}`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
