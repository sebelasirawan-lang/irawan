import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInAnonymously,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  LayoutDashboard,
  QrCode,
  Printer,
  History,
  Search,
  Download,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Package,
  RefreshCw,
  LogIn,
  LogOut,
  Edit3,
  Radio,
  Filter,
  Boxes,
  Wallet,
  RotateCcw,
  FileSpreadsheet,
  Trash2,
  FileText,
  ClipboardCheck,
  Cloud,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  loginWithGoogle,
  logoutFirebase,
  OperationType,
} from './firebase';
import {
  InventoryItem,
  WarehouseTransaction,
  TransactionType,
  QrPayloadMode,
  calculateAkhirQty,
  calculateMovementStatus,
  calculateRemark,
  calculateTotalValue,
  formatDateDdMmmmYy,
  formatLedgerDate,
  formatRupiah,
  parsePartNumbers,
  ITEM_TYPE_LABELS,
  splitPicAndRecipient,
} from './types/warehouse';
import { INITIAL_INVENTORY_ITEMS, INITIAL_TRANSACTIONS } from './data/initialInventory';
import { QrScannerPanel } from './components/QrScannerPanel';
import { QrLabelStudio } from './components/QrLabelStudio';
import { ItemFormModal } from './components/ItemFormModal';
import { QrQuickModal } from './components/QrQuickModal';
import { ExcelImportModal } from './components/ExcelImportModal';
import { DeleteItemModal } from './components/DeleteItemModal';
import { DeleteTransactionModal } from './components/DeleteTransactionModal';
import { ResetDataModal } from './components/ResetDataModal';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { PrintReportPanel } from './components/PrintReportPanel';
import {
  LogCsvEditorModal,
  serializeTransactionsToCsv,
} from './components/LogCsvEditorModal';
import {
  StockOpnamePanel,
  OpnameAdjustmentPayload,
} from './components/StockOpnamePanel';

const STORAGE_ITEMS_KEY = 'gudangpro_inventory_v1';
const STORAGE_TX_KEY = 'gudangpro_transactions_v1';
const BROADCAST_CHANNEL_NAME = 'gudangpro_realtime_channel';
const deleteAllInventoryFromFirestore = async () => {
  try {
    console.log('MULAI MENGHAPUS INVENTORY FIRESTORE...');

    const snapshot = await getDocs(
      collection(db, 'inventory_items')
    );

    console.log(
      `Ditemukan ${snapshot.size} item di Firestore.`
    );

    if (snapshot.empty) {
      console.log('inventory_items sudah kosong.');
      return;
    }

    const CHUNK_SIZE = 400;

    for (let i = 0; i < snapshot.docs.length; i += CHUNK_SIZE) {
      const chunk = snapshot.docs.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);

      chunk.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();

      console.log(
        `Terhapus ${Math.min(
          i + CHUNK_SIZE,
          snapshot.docs.length
        )} / ${snapshot.docs.length}`
      );
    }

    console.log(
      `BERHASIL: ${snapshot.size} item inventory dihapus dari Firestore.`
    );
  } catch (error) {
    console.error(
      'GAGAL MENGHAPUS INVENTORY FIRESTORE:',
      error
    );
  }
};
export default function App() {
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'SCANNER' | 'STOCK_OPNAME' | 'QR_LABELS' | 'HISTORY' | 'PRINT_REPORT'>('DASHBOARD');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [cloudSynced, setCloudSynced] = useState<boolean>(false);

  // Inventory & Transaction State (Initialized with CSV dataset + local persistence, normalized to dd-mmmm-yy & dynamic Moving Status)
  const [items, setItems] = useState<InventoryItem[]>(() => {
    const normalizeItems = (list: InventoryItem[]) =>
      list.map((item) => {
        const formattedUpdate = formatDateDdMmmmYy(item.tanggalUpdate);
        const mvStatus = calculateMovementStatus(formattedUpdate);
        return {
          ...item,
          tanggalUpdate: formattedUpdate,
          tanggalMasuk: formatDateDdMmmmYy(item.tanggalMasuk),
          tanggalKeluar: formatDateDdMmmmYy(item.tanggalKeluar),
          movementStatus: mvStatus,
          status1th: mvStatus,
        };
      });
    try {
      const saved = localStorage.getItem(STORAGE_ITEMS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return normalizeItems(parsed);
      }
    } catch {
      // Fallback to initial CSV items
    }
    return normalizeItems(INITIAL_INVENTORY_ITEMS);
  });

  const [transactions, setTransactions] = useState<WarehouseTransaction[]>(() => {
    const normalizeTx = (list: WarehouseTransaction[]) =>
      list.map((tx) => ({
        ...tx,
        dateStr: formatDateDdMmmmYy(tx.dateStr),
      }));
    try {
      const saved = localStorage.getItem(STORAGE_TX_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return normalizeTx(parsed);
      }
    } catch {
      // Fallback to initial transactions
    }
    return normalizeTx(INITIAL_TRANSACTIONS);
  });

  // Filters for Dashboard Master Table
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [remarkFilter, setRemarkFilter] = useState<string>('ALL');
  const [movementFilter, setMovementFilter] = useState<string>('ALL');
  const [unitFilter, setUnitFilter] = useState<string>('ALL');
  const [pageSize, setPageSize] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Filters & Pagination for History Log
  const [txTypeFilter, setTxTypeFilter] = useState<string>('ALL');
  const [txSearch, setTxSearch] = useState<string>('');
  const [txPageSize, setTxPageSize] = useState<number>(100);
  const [txPage, setTxPage] = useState<number>(1);

  // Modals & Scanner Preselection
  const [scannerPreselectedCode, setScannerPreselectedCode] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);
  const [deletingTx, setDeletingTx] = useState<WarehouseTransaction | null>(null);
  const [isBulkDeletingTx, setIsBulkDeletingTx] = useState<boolean>(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [isGoogleDriveModalOpen, setIsGoogleDriveModalOpen] = useState<boolean>(false);
  const [isLogCsvEditorOpen, setIsLogCsvEditorOpen] = useState<boolean>(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isImportExcelModalOpen, setIsImportExcelModalOpen] = useState<boolean>(false);
  const [qrPreviewItem, setQrPreviewItem] = useState<InventoryItem | null>(null);
  const [qrPreviewMode, setQrPreviewMode] = useState<QrPayloadMode>('PART_NUMBER');
  const [qrPreviewPn, setQrPreviewPn] = useState<string | undefined>(undefined);

  // Real-time highlight & live notification banner
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null);
  const [liveToast, setLiveToast] = useState<{
    title: string;
    detail: string;
    txType: TransactionType;
  } | null>(null);

  const broadcastRef = useRef<BroadcastChannel | null>(null);

  // Helper to commit up to 3,000+ inventory items to Firestore in safe chunks of 400 (Firestore max is 500 per WriteBatch)
  const syncItemsToFirestoreInChunks = async (
    itemsToSync: InventoryItem[],
    uid: string
  ) => {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < itemsToSync.length; i += CHUNK_SIZE) {
      const chunk = itemsToSync.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, 'inventory_items', item.codeItem);
        batch.set(
          ref,
          {
            ...item,
            orgId: 'gudang_utama',
            updatedByUid: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    }
  };
/*const localInventorySyncDone = useRef<string | null>(null);

useEffect(() => {
  if (!user) {
    localInventorySyncDone.current = null;
    return;
  }

  if (localInventorySyncDone.current === user.uid) return;

  const syncLocalInventory = async () => {
    try {
      const localData = localStorage.getItem(STORAGE_ITEMS_KEY);
      if (!localData) return;

      const localItems: InventoryItem[] = JSON.parse(localData);

      if (!Array.isArray(localItems) || localItems.length === 0) return;

      console.log(
        `Sinkronisasi ${localItems.length} item lokal ke Firestore...`
      );

      await syncItemsToFirestoreInChunks(localItems, user.uid);

      localInventorySyncDone.current = user.uid;

      console.log(
        `BERHASIL: ${localItems.length} item lokal sudah disinkronkan ke Firestore.`
      );
    } catch (error) {
      console.error(
        'GAGAL SINKRONISASI INVENTORY LOKAL KE FIRESTORE:',
        error
      );
    }
  };

  syncLocalInventory();
}, [user]);
*/
  // Save to localStorage whenever items or transactions update
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ITEMS_KEY, JSON.stringify(items));
    } catch {
      // ignore storage quota errors
    }
  }, [items]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_TX_KEY, JSON.stringify(transactions));
    } catch {
      // ignore storage quota errors
    }
  }, [transactions]);

  // Set up BroadcastChannel for instant multi-tab / multi-window real-time sync
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastRef.current = channel;

    channel.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'SYNC_TRANSACTION') {
        const { updatedItem, newTx } = data.payload as {
          updatedItem: InventoryItem;
          newTx: WarehouseTransaction;
        };
        setItems((prev) =>
          prev.map((item) => (item.codeItem === updatedItem.codeItem ? updatedItem : item))
        );
        setTransactions((prev) => {
          if (prev.some((t) => t.id === newTx.id)) return prev;
          return [newTx, ...prev];
        });
        triggerRealtimeHighlight(updatedItem.codeItem, newTx);
      } else if (data.type === 'SYNC_ITEM_SAVE') {
        const savedItem = data.payload as InventoryItem;
        setItems((prev) => {
          const exists = prev.some((i) => i.codeItem === savedItem.codeItem);
          if (exists) {
            return prev.map((i) => (i.codeItem === savedItem.codeItem ? savedItem : i));
          }
          return [...prev, savedItem].sort((a, b) => a.no - b.no);
        });
      } else if (data.type === 'SYNC_BULK_ITEMS') {
        const nextItems = data.payload as InventoryItem[];
        if (Array.isArray(nextItems)) {
          setItems(nextItems);
        }
      } else if (data.type === 'SYNC_ITEM_DELETE') {
        const deletedCode = data.payload as string;
        if (deletedCode) {
          setItems((prev) => prev.filter((i) => i.codeItem !== deletedCode));
        }
      } else if (data.type === 'SYNC_TX_DELETE') {
        const { deletedIds, updatedItems } = data.payload as {
          deletedIds: string[];
          updatedItems?: InventoryItem[];
        };
        if (Array.isArray(deletedIds)) {
          setTransactions((prev) => prev.filter((t) => !deletedIds.includes(t.id)));
        }
        if (Array.isArray(updatedItems)) {
          setItems(updatedItems);
        }
      } else if (data.type === 'SYNC_TX_UPDATE') {
        const updatedTx = data.payload as WarehouseTransaction;
        if (updatedTx && updatedTx.id) {
          setTransactions((prev) =>
            prev.map((t) => (t.id === updatedTx.id ? updatedTx : t))
          );
        }
      }
    };

    return () => {
      channel.close();
    };
  }, []);

  // Track Firebase Auth state
useEffect(() => {
  const unsub = onAuthStateChanged(auth, async (currentUser) => {
    try {
      if (currentUser) {
        setUser(currentUser);
        setAuthReady(true);
        return;
      }

      // Login otomatis tanpa perlu login manual
      const result = await signInAnonymously(auth);

      console.log(
        'Firebase Anonymous Auth berhasil:',
        result.user.uid
      );

      setUser(result.user);
      setAuthReady(true);
    } catch (error) {
      console.error(
        'GAGAL FIREBASE ANONYMOUS AUTH:',
        error
      );

      setUser(null);
      setAuthReady(true);
    }
  });

  return () => unsub();
}, []);

  // Real-time Firestore listener when user is authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setCloudSynced(false);
      return;
    }

    const itemsQuery = query(
      collection(db, 'inventory_items'),
      where('orgId', '==', 'gudang_utama')
    );

    const unsubItems = onSnapshot(
      itemsQuery,
      async (snapshot) => {
        setCloudSynced(true);
        if (snapshot.empty) {
          // Seed initial CSV inventory into Firestore if empty
          try {
            const batch = writeBatch(db);
            for (const item of INITIAL_INVENTORY_ITEMS) {
              const ref = doc(db, 'inventory_items', item.codeItem);
              batch.set(ref, {
                ...item,
                orgId: 'gudang_utama',
                updatedByUid: user.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit();
          } catch (err) {
            console.warn('Could not auto-seed Firestore inventory:', err);
          }
          return;
        }

        const remoteItems: InventoryItem[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data() as InventoryItem;
          const formattedUpdate = formatDateDdMmmmYy(d.tanggalUpdate);
          const mvStatus = calculateMovementStatus(formattedUpdate);
          remoteItems.push({
            ...d,
            tanggalUpdate: formattedUpdate,
            tanggalMasuk: formatDateDdMmmmYy(d.tanggalMasuk),
            tanggalKeluar: formatDateDdMmmmYy(d.tanggalKeluar),
            movementStatus: mvStatus,
            status1th: mvStatus,
          });
        });
        remoteItems.sort((a, b) => a.no - b.no);
        setItems(remoteItems);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'inventory_items');
        } catch {
          setCloudSynced(false);
        }
      }
    );

    const txQuery = query(
      collection(db, 'transactions'),
      where('orgId', '==', 'gudang_utama')
    );

    const unsubTx = onSnapshot(
      txQuery,
      (snapshot) => {
        if (snapshot.empty) return;
        const remoteTx: WarehouseTransaction[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data() as WarehouseTransaction;
          remoteTx.push({
            ...d,
            timestampMs: d.timestampMs || Date.now(),
          });
        });
        remoteTx.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
        setTransactions(remoteTx);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'transactions');
        } catch {
          // fallback silently to local state if rules aren't deployed yet
        }
      }
    );

    return () => {
      unsubItems();
      unsubTx();
    };
  }, [authReady, user]);

  const triggerRealtimeHighlight = (codeItem: string, tx: WarehouseTransaction) => {
    const { officer, recipient } = splitPicAndRecipient(tx);
    setHighlightedCode(codeItem);
    setLiveToast({
      title: `Sinkronisasi QR Real-Time: [${tx.codeItem}] ${tx.partName}`,
      detail: `${
        tx.txType === 'IN'
          ? 'Barang Masuk (+IN)'
          : tx.txType === 'OUT'
          ? 'Barang Keluar (-OUT)'
          : tx.txType === 'ADJ_PLUS'
          ? 'Penyesuaian (+)'
          : 'Penyesuaian (-)'
      } sebanyak ${tx.qty} Pcs${
        officer && officer !== '-' ? ` • Petugas: ${officer}` : ''
      }${
        recipient && recipient !== '-' ? ` | Penerima: ${recipient}` : ''
      }. Stok Akhir: ${tx.prevAkhirQty} → ${tx.newAkhirQty} Pcs.`,
      txType: tx.txType,
    });
    setTimeout(() => setHighlightedCode(null), 4500);
    setTimeout(() => setLiveToast(null), 6500);
  };

  // Core Handler: Process Daily IN / OUT / Adjustment via QR Scanner or Dashboard
  const handleRecordTransaction = async (params: {
    codeItem: string;
    txType: TransactionType;
    qty: number;
    picName: string;
    recipientName: string;
    unitRef: string;
    notes: string;
    source: 'QR_SCANNER' | 'MANUAL_ADMIN';
  }) => {
    const target = items.find(
      (i) => i.codeItem.toUpperCase() === params.codeItem.toUpperCase()
    );
    if (!target) return;

    const todayStr = formatLedgerDate();
    const newInQty = target.inQty + (params.txType === 'IN' ? params.qty : 0);
    const newAdjPlusQty =
      target.adjPlusQty + (params.txType === 'ADJ_PLUS' ? params.qty : 0);
    const newOutQty = target.outQty + (params.txType === 'OUT' ? params.qty : 0);
    const newAdjMinusQty =
      target.adjMinusQty + (params.txType === 'ADJ_MINUS' ? params.qty : 0);

    const newAkhirQty = calculateAkhirQty(
      target.awalQty,
      newInQty,
      newAdjPlusQty,
      newOutQty,
      newAdjMinusQty
    );
    const newRemark = calculateRemark(newAkhirQty, target.minQty, target.maxQty);
    const newTotalValue = calculateTotalValue(newAkhirQty, target.price);
    const newMovementStatus = calculateMovementStatus(todayStr);

    const updatedItem: InventoryItem = {
      ...target,
      inQty: newInQty,
      adjPlusQty: newAdjPlusQty,
      outQty: newOutQty,
      adjMinusQty: newAdjMinusQty,
      akhirQty: newAkhirQty,
      remark: newRemark,
      movementStatus: newMovementStatus,
      status1th: newMovementStatus,
      totalValue: newTotalValue,
      tanggalUpdate: todayStr,
      tanggalMasuk: params.txType === 'IN' ? todayStr : target.tanggalMasuk,
      tanggalKeluar: params.txType === 'OUT' ? todayStr : target.tanggalKeluar,
      updatedByUid: user?.uid || 'operator_local',
    };

    const txId = `TX-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const newTx: WarehouseTransaction = {
      id: txId,
      codeItem: target.codeItem,
      partName: target.partName,
      partNumber: target.partNumber,
      rak: target.rak,
      typeCode: target.typeCode,
      txType: params.txType,
      qty: params.qty,
      prevAkhirQty: target.akhirQty,
      newAkhirQty,
      picName: params.picName,
      recipientName: params.recipientName,
      unitRef: params.unitRef,
      notes: params.notes,
      dateStr: todayStr,
      timestampMs: Date.now(),
      source: params.source,
      orgId: 'gudang_utama',
      operatorUid: user?.uid || 'operator_local',
    };

    // 1. Optimistic local state update
    setItems((prev) =>
      prev.map((item) => (item.codeItem === updatedItem.codeItem ? updatedItem : item))
    );
    setTransactions((prev) => [newTx, ...prev]);
    triggerRealtimeHighlight(updatedItem.codeItem, newTx);

    // 2. Broadcast to other open tabs/windows (Admin Dashboard <-> Scanner Window)
    broadcastRef.current?.postMessage({
      type: 'SYNC_TRANSACTION',
      payload: { updatedItem, newTx },
    });

    // 3. Persist to Firestore if authenticated
    if (user) {
      try {
        const itemRef = doc(db, 'inventory_items', updatedItem.codeItem);
        await setDoc(
          itemRef,
          {
            ...updatedItem,
            orgId: 'gudang_utama',
            updatedByUid: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        const txRef = doc(db, 'transactions', newTx.id);
        const { timestampMs, recipientName, ...firestoreTxPayload } = newTx;
        const combinedPic = recipientName
          ? `${params.picName} | Penerima: ${recipientName}`.slice(0, 100)
          : params.picName.slice(0, 100);
        await setDoc(txRef, {
          ...firestoreTxPayload,
          picName: combinedPic,
          operatorUid: user.uid,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
  console.error('GAGAL SINKRONISASI KE FIRESTORE:', error);

  setLiveToast({
    type: 'error',
    message: 'Gagal menyimpan perubahan ke Firestore. Data masih tersimpan lokal di PC.',
  });

  setTimeout(() => setLiveToast(null), 8000);
      }
    }
  };

  // Save New or Edited Master Item
  const handleSaveMasterItem = async (savedItem: InventoryItem) => {
    setItems((prev) => {
      const exists = prev.some((i) => i.codeItem === savedItem.codeItem);
      if (exists) {
        return prev.map((i) => (i.codeItem === savedItem.codeItem ? savedItem : i));
      }
      return [...prev, savedItem].sort((a, b) => a.no - b.no);
    });

    broadcastRef.current?.postMessage({
      type: 'SYNC_ITEM_SAVE',
      payload: savedItem,
    });

    if (user) {
      try {
        const itemRef = doc(db, 'inventory_items', savedItem.codeItem);
        await setDoc(
          itemRef,
          {
            ...savedItem,
            orgId: 'gudang_utama',
            updatedByUid: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('Disimpan ke lokal:', err);
      }
    }
  };

  // Delete Master Item (Password Verified)
  const handleDeleteItem = async (codeItem: string) => {
    const target = items.find((i) => i.codeItem === codeItem);
    setItems((prev) => prev.filter((i) => i.codeItem !== codeItem));

    broadcastRef.current?.postMessage({
      type: 'SYNC_ITEM_DELETE',
      payload: codeItem,
    });

    if (target) {
      setLiveToast({
        title: `Item Dihapus: [${target.codeItem}]`,
        detail: `${target.partName} (${target.partNumber}) telah dihapus secara permanen dari inventaris gudang.`,
        txType: 'OUT',
      });
      setTimeout(() => setLiveToast(null), 5500);
    }

    if (user) {
      try {
        await deleteDoc(doc(db, 'inventory_items', codeItem));
      } catch (err) {
        console.warn('Dihapus dari lokal; gagal hapus dari Firestore:', err);
      }
    }
  };

  // Delete Single or Bulk Transactions from Log Harian (Password "11tiga89" Verified)
  const handleDeleteTransactions = async (
    targets: WarehouseTransaction[],
    revertStock: boolean
  ) => {
    if (targets.length === 0) return;
    const deletedIds = targets.map((t) => t.id);

    let nextItems = [...items];
    if (revertStock) {
      const itemMap = new Map<string, InventoryItem>();
      nextItems.forEach((it) => itemMap.set(it.codeItem.toUpperCase(), { ...it }));

      for (const tx of targets) {
        const item = itemMap.get(tx.codeItem.toUpperCase());
        if (!item) continue;
        const nextIn =
          tx.txType === 'IN' ? Math.max(0, item.inQty - tx.qty) : item.inQty;
        const nextAdjPlus =
          tx.txType === 'ADJ_PLUS'
            ? Math.max(0, item.adjPlusQty - tx.qty)
            : item.adjPlusQty;
        const nextOut =
          tx.txType === 'OUT' ? Math.max(0, item.outQty - tx.qty) : item.outQty;
        const nextAdjMinus =
          tx.txType === 'ADJ_MINUS'
            ? Math.max(0, item.adjMinusQty - tx.qty)
            : item.adjMinusQty;
        const nextAkhir = calculateAkhirQty(
          item.awalQty,
          nextIn,
          nextAdjPlus,
          nextOut,
          nextAdjMinus
        );
        const nextRemark = calculateRemark(nextAkhir, item.minQty, item.maxQty);
        const nextTotalVal = calculateTotalValue(nextAkhir, item.price);

        itemMap.set(tx.codeItem.toUpperCase(), {
          ...item,
          inQty: nextIn,
          adjPlusQty: nextAdjPlus,
          outQty: nextOut,
          adjMinusQty: nextAdjMinus,
          akhirQty: nextAkhir,
          remark: nextRemark,
          totalValue: nextTotalVal,
        });
      }
      nextItems = Array.from(itemMap.values()).sort((a, b) => a.no - b.no);
      setItems(nextItems);
    }

    setTransactions((prev) => prev.filter((t) => !deletedIds.includes(t.id)));

    broadcastRef.current?.postMessage({
      type: 'SYNC_TX_DELETE',
      payload: {
        deletedIds,
        updatedItems: revertStock ? nextItems : undefined,
      },
    });

    setLiveToast({
      title:
        targets.length === 1
          ? `Log Harian Dihapus: [${targets[0].codeItem}]`
          : `${targets.length} Log Harian Dihapus`,
      detail:
        targets.length === 1
          ? `Riwayat transaksi ${targets[0].partName} (${targets[0].qty} Pcs) telah dihapus${
              revertStock ? ' & stok dikembalikan' : ''
            }.`
          : `${targets.length} riwayat transaksi harian telah dihapus secara permanen.`,
      txType: 'OUT',
    });
    setTimeout(() => setLiveToast(null), 5500);

    if (user) {
      try {
        const batch = writeBatch(db);
        for (const tx of targets) {
          batch.delete(doc(db, 'transactions', tx.id));
        }
        if (revertStock) {
          const affectedCodes = new Set(targets.map((t) => t.codeItem.toUpperCase()));
          for (const it of nextItems) {
            if (affectedCodes.has(it.codeItem.toUpperCase())) {
              batch.set(
                doc(db, 'inventory_items', it.codeItem),
                {
                  ...it,
                  updatedByUid: user.uid,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            }
          }
        }
        await batch.commit();
      } catch (err) {
        console.warn('Log dihapus dari lokal; gagal hapus dari Firestore:', err);
      }
    }
  };

  // Update Transaction Metadata (Nama Mekanik Pengambil, Code Unit, PIC Logistik) from Report or History
  const handleUpdateTransaction = async (updatedTx: WarehouseTransaction) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === updatedTx.id ? updatedTx : t))
    );

    broadcastRef.current?.postMessage({
      type: 'SYNC_TX_UPDATE',
      payload: updatedTx,
    });

    if (user) {
      try {
        const txRef = doc(db, 'transactions', updatedTx.id);
        const { timestampMs, recipientName, ...firestoreTxPayload } = updatedTx;
        const combinedPic = recipientName
          ? `${updatedTx.picName} | Penerima: ${recipientName}`.slice(0, 100)
          : updatedTx.picName.slice(0, 100);
        await setDoc(
          txRef,
          {
            ...firestoreTxPayload,
            picName: combinedPic,
            operatorUid: user.uid,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('Transaksi diperbarui di lokal:', err);
      }
    }
  };

  // Apply Daily Stock Opname Adjustments (Single or Bulk) to Master Inventory & Log Harian
  const handleApplyStockOpnameAdjustments = async (
    adjustments: OpnameAdjustmentPayload[]
  ) => {
    if (adjustments.length === 0) return;
    const todayStr = formatLedgerDate();
    const itemMap = new Map<string, InventoryItem>();
    items.forEach((it) => itemMap.set(it.codeItem.toUpperCase(), { ...it }));

    const newTransactions: WarehouseTransaction[] = [];
    const updatedItemsList: InventoryItem[] = [];

    for (const adj of adjustments) {
      const target = itemMap.get(adj.codeItem.toUpperCase());
      if (!target) continue;

      const diff = adj.physicalQty - target.akhirQty;
      if (diff === 0) continue;

      const txType: TransactionType = diff > 0 ? 'ADJ_PLUS' : 'ADJ_MINUS';
      const absQty = Math.abs(diff);

      const newAdjPlusQty =
        target.adjPlusQty + (txType === 'ADJ_PLUS' ? absQty : 0);
      const newAdjMinusQty =
        target.adjMinusQty + (txType === 'ADJ_MINUS' ? absQty : 0);
      const newAkhirQty = calculateAkhirQty(
        target.awalQty,
        target.inQty,
        newAdjPlusQty,
        target.outQty,
        newAdjMinusQty
      );
      const newRemark = calculateRemark(newAkhirQty, target.minQty, target.maxQty);
      const newTotalValue = calculateTotalValue(newAkhirQty, target.price);
      const newMovementStatus = calculateMovementStatus(todayStr);

      const updatedItem: InventoryItem = {
        ...target,
        adjPlusQty: newAdjPlusQty,
        adjMinusQty: newAdjMinusQty,
        akhirQty: newAkhirQty,
        remark: newRemark,
        movementStatus: newMovementStatus,
        status1th: newMovementStatus,
        totalValue: newTotalValue,
        tanggalUpdate: todayStr,
        updatedByUid: user?.uid || 'opname_local',
      };

      itemMap.set(target.codeItem.toUpperCase(), updatedItem);
      updatedItemsList.push(updatedItem);

      const txId = `OPN-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;
      newTransactions.push({
        id: txId,
        codeItem: target.codeItem,
        partName: target.partName,
        partNumber: target.partNumber,
        rak: target.rak,
        typeCode: target.typeCode,
        txType,
        qty: absQty,
        prevAkhirQty: target.akhirQty,
        newAkhirQty,
        picName: adj.picLogistik || 'PIC Logistik',
        recipientName: adj.auditorName || 'Tim Opname',
        unitRef: target.codeUnit || target.modelUnit || '-',
        notes: adj.notes || 'Koreksi Stock Opname Harian',
        dateStr: todayStr,
        timestampMs: Date.now(),
        source: 'MANUAL_ADMIN',
        orgId: 'gudang_utama',
        operatorUid: user?.uid || 'opname_local',
      });
    }

    if (newTransactions.length === 0) return;

    const nextAllItems = Array.from(itemMap.values()).sort((a, b) => a.no - b.no);
    setItems(nextAllItems);
    setTransactions((prev) => [...newTransactions, ...prev]);

    broadcastRef.current?.postMessage({
      type: 'SYNC_BULK_ITEMS',
      payload: nextAllItems,
    });
    for (const tx of newTransactions) {
      const matched = itemMap.get(tx.codeItem.toUpperCase());
      if (matched) {
        broadcastRef.current?.postMessage({
          type: 'SYNC_TRANSACTION',
          payload: { updatedItem: matched, newTx: tx },
        });
      }
    }

    setLiveToast({
      title:
        newTransactions.length === 1
          ? `Stock Opname Disesuaikan: [${newTransactions[0].codeItem}]`
          : `${newTransactions.length} Item Stock Opname Disesuaikan!`,
      detail:
        newTransactions.length === 1
          ? `Stok ${newTransactions[0].partName} disesuaikan dari ${newTransactions[0].prevAkhirQty} → ${newTransactions[0].newAkhirQty} Pcs & tercatat di Log Harian.`
          : `${newTransactions.length} selisih stok fisik berhasil disesuaikan ke Master Gudang & Log Harian.`,
      txType: newTransactions[0].txType,
    });
    setTimeout(() => setLiveToast(null), 6000);

    if (user) {
      try {
        await syncItemsToFirestoreInChunks( updatedItemsList, user.uid);
        const TX_CHUNK = 400;
        for (let i = 0; i < newTransactions.length; i += TX_CHUNK) {
          const chunk = newTransactions.slice(i, i + TX_CHUNK);
          const batch = writeBatch(db);
          for (const tx of chunk) {
            const { timestampMs, recipientName, ...firestoreTxPayload } = tx;
            const combinedPic = recipientName
              ? `${tx.picName} | Penerima: ${recipientName}`.slice(0, 100)
              : tx.picName.slice(0, 100);
            batch.set(doc(db, 'transactions', tx.id), {
              ...firestoreTxPayload,
              picName: combinedPic,
              operatorUid: user.uid,
              createdAt: serverTimestamp(),
            });
          }
          await batch.commit();
        }
      } catch (err) {
        console.warn('Opname disimpan ke lokal; gagal batch write Firestore:', err);
      }
    }
  };

  // Bulk Import from Excel (.xlsx / .xls / .csv)
  const handleBulkImportExcel = async (
    importedItems: InventoryItem[],
    mode: 'MERGE' | 'REPLACE'
  ) => {
    let nextList: InventoryItem[] = [];
    if (mode === 'REPLACE') {
      nextList = [...importedItems].sort((a, b) => a.no - b.no);
    } else {
      const map = new Map<string, InventoryItem>();
      for (const existing of items) {
        map.set(existing.codeItem.toUpperCase(), existing);
      }
      for (const incoming of importedItems) {
        map.set(incoming.codeItem.toUpperCase(), {
          ...incoming,
          updatedByUid: user?.uid || 'excel_import',
        });
      }
      nextList = Array.from(map.values()).sort((a, b) => a.no - b.no);
    }

    setItems(nextList);

    broadcastRef.current?.postMessage({
      type: 'SYNC_BULK_ITEMS',
      payload: nextList,
    });

    setLiveToast({
      title: 'Import dari CSV Berhasil!',
      detail: `${importedItems.length} data barang berhasil diimpor dari CSV (${
        mode === 'MERGE' ? 'Digabungkan/Update' : 'Diganti Semua'
      }) dan QR Code otomatis siap digunakan.`,
      txType: 'IN',
    });
    setTimeout(() => setLiveToast(null), 6500);

    if (user) {
      try {
        await syncItemsToFirestoreInChunks(importedItems, user.uid);
      } catch (err) {
        console.warn('Disimpan ke lokal; gagal batch write Firestore:', err);
      }
    }
  };

  // Reset to initial CSV data (Password "11tiga89" Verified)
  const handleResetToCsvDefault = async () => {
    const defaultItems = INITIAL_INVENTORY_ITEMS.map((item) => {
      const formattedUpdate = formatDateDdMmmmYy(item.tanggalUpdate);
      const mvStatus = calculateMovementStatus(formattedUpdate);
      return {
        ...item,
        tanggalUpdate: formattedUpdate,
        tanggalMasuk: formatDateDdMmmmYy(item.tanggalMasuk),
        tanggalKeluar: formatDateDdMmmmYy(item.tanggalKeluar),
        movementStatus: mvStatus,
        status1th: mvStatus,
      };
    });
    const defaultTx = INITIAL_TRANSACTIONS.map((tx) => ({
      ...tx,
      dateStr: formatDateDdMmmmYy(tx.dateStr),
    }));

    setItems(defaultItems);
    setTransactions(defaultTx);
    localStorage.removeItem(STORAGE_ITEMS_KEY);
    localStorage.removeItem(STORAGE_TX_KEY);

    broadcastRef.current?.postMessage({
      type: 'SYNC_BULK_ITEMS',
      payload: defaultItems,
    });

    setLiveToast({
      title: 'Reset Data Gudang Berhasil',
      detail:
        'Seluruh data Master Barang dan Log Harian telah dikembalikan ke data awal standar.',
      txType: 'IN',
    });
    setTimeout(() => setLiveToast(null), 5500);
  };

  // Restore inventory & transactions from Google Drive Cloud JSON backup
  const handleRestoreFromDrive = async (data: {
    items: InventoryItem[];
    transactions: WarehouseTransaction[];
    fileName: string;
  }) => {
    const normalizedItems = data.items.map((item, idx) => {
      const formattedUpdate = formatDateDdMmmmYy(item.tanggalUpdate);
      const mvStatus = calculateMovementStatus(formattedUpdate);
      const akhir = calculateAkhirQty(
        item.awalQty,
        item.inQty,
        item.adjPlusQty,
        item.outQty,
        item.adjMinusQty
      );
      const remark = calculateRemark(akhir, item.minQty, item.maxQty);
      const totalValue = calculateTotalValue(akhir, item.price);
      return {
        ...item,
        no: item.no || idx + 1,
        akhirQty: akhir,
        remark,
        totalValue,
        tanggalUpdate: formattedUpdate,
        tanggalMasuk: formatDateDdMmmmYy(item.tanggalMasuk),
        tanggalKeluar: formatDateDdMmmmYy(item.tanggalKeluar),
        movementStatus: mvStatus,
        status1th: mvStatus,
      };
    });

    const normalizedTx = data.transactions.map((tx) => ({
      ...tx,
      dateStr: formatDateDdMmmmYy(tx.dateStr),
    }));

    setItems(normalizedItems);
    setTransactions(normalizedTx);

    broadcastRef.current?.postMessage({
      type: 'SYNC_BULK_ITEMS',
      payload: normalizedItems,
    });

    setLiveToast({
      title: 'Data Dipulihkan dari Google Drive!',
      detail: `${normalizedItems.length} Master Barang & ${normalizedTx.length} Log Transaksi berhasil dimuat dari "${data.fileName}".`,
      txType: 'IN',
    });
    setTimeout(() => setLiveToast(null), 6000);

    if (user) {
      try {
        await syncItemsToFirestoreInChunks(normalizedItems, user.uid);
      } catch (err) {
        console.warn('Disimpan ke lokal; gagal batch write Firestore saat restore Drive:', err);
      }
    }
  };

  // Export Master Inventory to exact CSV format
  const handleExportInventoryCsv = () => {
    const headers = [
      'No',
      'Code Item',
      'Code Rak',
      'Type Code',
      'Model Unit',
      'Part Number',
      'Part Name',
      'CODE UNIT',
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
      'Unit Akhir',
      'MIN',
      'MAX',
      'REMARK',
      '9/30/2026',
      'Price',
      'Total',
      'Note',
      'Status 1th',
    ];

    const rows = items.map((item) => {
      const mvStatus = calculateMovementStatus(item.tanggalUpdate);
      return [
        item.no,
        item.codeItem,
        `"${item.rak}"`,
        item.typeCode,
        `"${item.modelUnit}"`,
        `"${item.partNumber}"`,
        `"${item.partName}"`,
        `"${item.codeUnit}"`,
        formatDateDdMmmmYy(item.tanggalUpdate),
        formatDateDdMmmmYy(item.tanggalMasuk),
        formatDateDdMmmmYy(item.tanggalKeluar),
        `"${item.supplier}"`,
        `"${item.brand}"`,
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
        mvStatus,
        `"${formatRupiah(item.price)}"`,
        `"${formatRupiah(item.totalValue)}"`,
        item.priceNote,
        mvStatus,
      ];
    });

    const csvString = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Laporan_Gudang_Harian_${formatLedgerDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download Log Harian Transactions to CSV
  const handleDownloadLogHarianCsv = (customTxList?: WarehouseTransaction[]) => {
    const targetList = customTxList ?? filteredTransactions;
    const csvString = serializeTransactionsToCsv(targetList, masterItemByCodeMap);
    const blob = new Blob(['\uFEFF' + csvString], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Log_Transaksi_Harian_MME_${formatLedgerDate()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Save Bulk Edited Transactions from Log CSV Editor Modal
  const handleSaveBulkTransactions = async (
    updatedTxList: WarehouseTransaction[]
  ) => {
    const normalized = updatedTxList.map((tx) => ({
      ...tx,
      dateStr: formatDateDdMmmmYy(tx.dateStr),
    }));
    setTransactions(normalized);

    setLiveToast({
      title: 'CSV Log Harian Berhasil Diperbarui!',
      detail: `${normalized.length} baris riwayat transaksi harian telah disimpan.`,
      txType: 'IN',
    });
    setTimeout(() => setLiveToast(null), 5500);

    if (user) {
      try {
        const CHUNK_SIZE = 400;
        for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
          const chunk = normalized.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          for (const tx of chunk) {
            const txRef = doc(db, 'transactions', tx.id);
            const { timestampMs, recipientName, ...firestoreTxPayload } = tx;
            const combinedPic =
              recipientName && recipientName !== '-'
                ? `${tx.picName} | Penerima: ${recipientName}`.slice(0, 100)
                : tx.picName.slice(0, 100);
            batch.set(
              txRef,
              {
                ...firestoreTxPayload,
                picName: combinedPic,
                operatorUid: user.uid,
                createdAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
          await batch.commit();
        }
      } catch (err) {
        console.warn('Disimpan ke lokal; gagal sinkron batch transaksi ke Firestore:', err);
      }
    }
  };

  // Computed KPI Metrics
  const kpi = useMemo(() => {
    const totalSku = items.length;
    const totalAkhirQty = items.reduce((acc, i) => acc + i.akhirQty, 0);
    const totalInQty = items.reduce((acc, i) => acc + i.inQty + i.adjPlusQty, 0);
    const totalOutQty = items.reduce((acc, i) => acc + i.outQty + i.adjMinusQty, 0);
    const totalAssetValue = items.reduce((acc, i) => acc + i.totalValue, 0);
    const orderCount = items.filter((i) => i.remark === 'ORDER').length;
    const overCount = items.filter((i) => i.remark === 'OVER').length;
    const amanCount = items.filter((i) => i.remark === 'AMAN').length;
    const fastMovingCount = items.filter(
      (i) => calculateMovementStatus(i.tanggalUpdate) === 'Fast Moving'
    ).length;
    const slowMovingCount = items.filter(
      (i) => calculateMovementStatus(i.tanggalUpdate) === 'Slow Moving'
    ).length;
    const deadMovingCount = items.filter(
      (i) => calculateMovementStatus(i.tanggalUpdate) === 'Dead Moving'
    ).length;
    const needsMetadataUpdate = items.filter(
      (i) => i.price === 0 || i.brand.includes('Update')
    ).length;

    return {
      totalSku,
      totalAkhirQty,
      totalInQty,
      totalOutQty,
      totalAssetValue,
      orderCount,
      overCount,
      amanCount,
      fastMovingCount,
      slowMovingCount,
      deadMovingCount,
      needsMetadataUpdate,
    };
  }, [items]);

  // Unique Model Units for Filter
  const uniqueUnits = useMemo(() => {
    return Array.from(new Set(items.map((i) => i.modelUnit)));
  }, [items]);

  // O(1) lookup map by Code Item for fast rendering across 3,000+ items
  const masterItemByCodeMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const it of items) {
      map.set(it.codeItem.toUpperCase(), it);
    }
    return map;
  }, [items]);

  // Filtered Master Inventory
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        item.codeItem.toLowerCase().includes(q) ||
        item.partName.toLowerCase().includes(q) ||
        item.partNumber.toLowerCase().includes(q) ||
        item.rak.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q) ||
        item.modelUnit.toLowerCase().includes(q);
      const matchesType = typeFilter === 'ALL' || item.typeCode === typeFilter;
      const matchesRemark = remarkFilter === 'ALL' || item.remark === remarkFilter;
      const itemMovement = calculateMovementStatus(item.tanggalUpdate);
      const matchesMovement =
        movementFilter === 'ALL' || itemMovement === movementFilter;
      const matchesUnit = unitFilter === 'ALL' || item.modelUnit === unitFilter;
      return (
        matchesSearch &&
        matchesType &&
        matchesRemark &&
        matchesMovement &&
        matchesUnit
      );
    });
  }, [items, searchQuery, typeFilter, remarkFilter, movementFilter, unitFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safePage, pageSize]);

  // Filtered Transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const matchesType = txTypeFilter === 'ALL' || tx.txType === txTypeFilter;
      const q = txSearch.toLowerCase();
      const matchesSearch =
        !q ||
        tx.codeItem.toLowerCase().includes(q) ||
        tx.partName.toLowerCase().includes(q) ||
        tx.picName.toLowerCase().includes(q) ||
        tx.unitRef.toLowerCase().includes(q) ||
        tx.notes.toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [transactions, txTypeFilter, txSearch]);

  const totalTxPages = Math.max(1, Math.ceil(filteredTransactions.length / txPageSize));
  const safeTxPage = Math.min(txPage, totalTxPages);

  const paginatedTransactions = useMemo(() => {
    const start = (safeTxPage - 1) * txPageSize;
    return filteredTransactions.slice(start, start + txPageSize);
  }, [filteredTransactions, safeTxPage, txPageSize]);

   const openScannerForItem = (codeItem: string) => {
    setScannerPreselectedCode(codeItem);
    setActiveTab('SCANNER');
  };

return (
  <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">

    <button
      onClick={deleteAllInventoryFromFirestore}
      className="m-4 rounded-lg bg-red-600 px-4 py-2 font-bold text-white"
    >
      HAPUS INVENTORY FIRESTORE
    </button>

    {/* Top Industrial Command Header */}
      <header className="no-print sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 lg:px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Brand & Live Status */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-slate-950 font-extrabold shadow-md shadow-amber-500/20">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 fle
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Industrial Command Header */}
      <header className="no-print sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 lg:px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Brand & Live Status */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-slate-950 font-extrabold shadow-md shadow-amber-500/20">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-slate-100">
                  PT. MEGA MULTI <span className="text-amber-400">ENERGI</span>
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-mono font-semibold text-emerald-300">
                  <Radio className="w-3 h-3 animate-pulse text-emerald-400" />
                  {cloudSynced ? 'CLOUD REAL-TIME' : 'LIVE SYNC AKTIF'}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[11px] font-mono font-bold text-amber-300">
                  Author: Irawan
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Sistem Pengeluaran & Pemasukan Harian Gudang • Pemindai QR Code Terintegrasi • Author: <strong className="text-slate-200">Irawan</strong>
              </p>
            </div>
          </div>

          {/* Primary Navigation Tabs */}
          <nav className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('DASHBOARD')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeTab === 'DASHBOARD'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Dashboard Admin
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SCANNER')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeTab === 'SCANNER'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <QrCode className="w-4 h-4" />
              Scanner QR (IN / OUT)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('STOCK_OPNAME')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeTab === 'STOCK_OPNAME'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
              Stock Opname Harian
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('QR_LABELS')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeTab === 'QR_LABELS'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Printer className="w-4 h-4" />
              Label QR Barang ({items.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('HISTORY')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeTab === 'HISTORY'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="w-4 h-4" />
              Log Harian ({transactions.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('PRINT_REPORT')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeTab === 'PRINT_REPORT'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-4 h-4" />
              Print Laporan
            </button>
          </nav>

          {/* Right Action & Cloud Auth */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsGoogleDriveModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/40 text-xs font-bold text-blue-300 transition cursor-pointer shadow-sm"
              title="Penyimpanan Cloud ke Google Drive (sebelasirawan@gmail.com)"
            >
              <Cloud className="w-4 h-4 text-blue-400" />
              <span className="hidden sm:inline">Google Drive Cloud</span>
            </button>

            {user ? (
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-semibold text-slate-200 leading-none">
                    {user.displayName || user.email}
                  </p>
                  <p className="text-[10px] text-emerald-400 font-mono mt-0.5">
                    Firestore Cloud Connected
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => logoutFirebase()}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                  title="Keluar dari Cloud Sync"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => loginWithGoogle()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer"
                title="Login Google untuk sinkronisasi antar perangkat berbeda (HP Scanner ke PC Admin)"
              >
                <LogIn className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Sinkronisasi Cloud</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Live Real-Time Toast Notification Banner */}
      {liveToast && (
        <div className="no-print fixed bottom-5 right-5 z-50 max-w-md bg-slate-900/95 backdrop-blur-md border-2 border-amber-500 rounded-2xl p-4 shadow-2xl flex items-start gap-3 animate-bounce">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              liveToast.txType === 'IN' || liveToast.txType === 'ADJ_PLUS'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/20 text-rose-400'
            }`}
          >
            {liveToast.txType === 'IN' || liveToast.txType === 'ADJ_PLUS' ? (
              <ArrowDownLeft className="w-5 h-5" />
            ) : (
              <ArrowUpRight className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              {liveToast.title}
            </p>
            <p className="text-xs text-slate-200 mt-1">{liveToast.detail}</p>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-6 py-6 space-y-6">
        {/* TAB 1: DASHBOARD ADMIN & MASTER TABLE */}
        {activeTab === 'DASHBOARD' && (
          <>
            {/* KPI Bento Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Total Stok & SKU */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Total Stok Akhir Fisik
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Package className="w-4 h-4" />
                  </div>
                </div>
                <div className="my-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold font-mono text-slate-100 tabular-nums">
                    {kpi.totalAkhirQty.toLocaleString('id-ID')}
                  </span>
                  <span className="text-xs text-slate-400 font-semibold">
                    Pcs ({kpi.totalSku} SKU)
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
                    CNU: {items.filter((i) => i.typeCode === 'CNU').length}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
                    SPT: {items.filter((i) => i.typeCode === 'SPT').length}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
                    PS: {items.filter((i) => i.typeCode === 'PS').length}
                  </span>
                </div>
              </div>

              {/* Card 2: Total Nilai Persediaan Gudang */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Total Nilai Aset Gudang
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Wallet className="w-4 h-4" />
                  </div>
                </div>
                <div className="my-2">
                  <span className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-400 tabular-nums">
                    {formatRupiah(kpi.totalAssetValue)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Kalkulasi: Akhir Qty × Price</span>
                  {kpi.needsMetadataUpdate > 0 && (
                    <span className="text-amber-400 font-medium">
                      {kpi.needsMetadataUpdate} item perlu update harga/brand
                    </span>
                  )}
                </div>
              </div>

              {/* Card 3: Akumulasi Pemasukan (IN) vs Pengeluaran (OUT) */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Arus Barang (IN vs OUT)
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                    <RefreshCw className="w-4 h-4" />
                  </div>
                </div>
                <div className="my-2 grid grid-cols-2 gap-2">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                    <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <ArrowDownLeft className="w-3 h-3" /> MASUK (IN)
                    </span>
                    <span className="font-mono text-lg font-extrabold text-emerald-300 tabular-nums">
                      +{kpi.totalInQty}
                    </span>
                  </div>
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">
                    <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" /> KELUAR (OUT)
                    </span>
                    <span className="font-mono text-lg font-extrabold text-rose-300 tabular-nums">
                      -{kpi.totalOutQty}
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Termasuk Penyesuaian (+/-)</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('SCANNER')}
                    className="text-amber-400 hover:underline font-semibold cursor-pointer"
                  >
                    + Scan Transaksi Baru
                  </button>
                </div>
              </div>

              {/* Card 4: Status Order / Restock Alert */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Status Remark Gudang
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                </div>
                <div className="my-2 grid grid-cols-3 gap-2 text-center">
                  <button
                    type="button"
                    onClick={() => setRemarkFilter(remarkFilter === 'ORDER' ? 'ALL' : 'ORDER')}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${
                      remarkFilter === 'ORDER'
                        ? 'bg-rose-500/30 border-rose-400'
                        : 'bg-rose-500/10 border-rose-500/20 hover:border-rose-500/40'
                    }`}
                  >
                    <span className="block font-mono text-lg font-extrabold text-rose-400">
                      {kpi.orderCount}
                    </span>
                    <span className="text-[10px] font-bold text-rose-300">ORDER</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemarkFilter(remarkFilter === 'AMAN' ? 'ALL' : 'AMAN')}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${
                      remarkFilter === 'AMAN'
                        ? 'bg-emerald-500/30 border-emerald-400'
                        : 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/40'
                    }`}
                  >
                    <span className="block font-mono text-lg font-extrabold text-emerald-400">
                      {kpi.amanCount}
                    </span>
                    <span className="text-[10px] font-bold text-emerald-300">AMAN</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemarkFilter(remarkFilter === 'OVER' ? 'ALL' : 'OVER')}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${
                      remarkFilter === 'OVER'
                        ? 'bg-amber-500/30 border-amber-400'
                        : 'bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40'
                    }`}
                  >
                    <span className="block font-mono text-lg font-extrabold text-amber-400">
                      {kpi.overCount}
                    </span>
                    <span className="text-[10px] font-bold text-amber-300">OVER</span>
                  </button>
                </div>
                <div className="text-[11px] text-slate-400">
                  Klik kotak status di atas untuk memfilter tabel
                </div>
              </div>
            </div>

            {/* Live Scanner Feed Strip (Recent 3 Transactions) */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Aktivitas Scan Terkini:
                </span>
              </div>
              <div className="flex-1 flex flex-wrap items-center gap-2 overflow-x-auto">
                {transactions.slice(0, 3).map((tx) => (
                  <div
                    key={tx.id}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                  >
                    <span
                      className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                        tx.txType === 'IN' || tx.txType === 'ADJ_PLUS'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {tx.txType === 'IN'
                        ? '+IN'
                        : tx.txType === 'OUT'
                        ? '-OUT'
                        : tx.txType === 'ADJ_PLUS'
                        ? '+ADJ'
                        : '-ADJ'}{' '}
                      {tx.qty}
                    </span>
                    <span className="font-mono font-bold text-amber-400">{tx.codeItem}</span>
                    <span className="text-slate-300 truncate max-w-[140px]">{tx.partName}</span>
                    <span className="text-slate-500 font-mono text-[11px]">
                      ({tx.prevAkhirQty}→{tx.newAkhirQty})
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('HISTORY')}
                className="text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                Lihat Semua Log →
              </button>
            </div>

            {/* Filter & Action Toolbar */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3.5 shadow-md">
              {/* Row 1: Search & Multi-Filter Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[260px]">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Cari Code Item (DPS-2105), Rak, Part Name, PN..."
                    className="w-full h-9 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-lg pl-9 pr-3 text-xs text-slate-100 outline-none transition"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs text-slate-400 mr-1">
                    <Filter className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-semibold hidden xl:inline">Filter:</span>
                  </div>

                  <select
                    value={typeFilter}
                    onChange={(e) => {
                      setTypeFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg px-2.5 text-xs text-slate-200 outline-none transition"
                  >
                    <option value="ALL">Semua Type (CNU/SPT/PS)</option>
                    <option value="CNU">CNU - Consumable</option>
                    <option value="SPT">SPT - Spare Part</option>
                    <option value="PS">PS - Part Service</option>
                  </select>

                  <select
                    value={unitFilter}
                    onChange={(e) => {
                      setUnitFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg px-2.5 text-xs text-slate-200 outline-none transition"
                  >
                    <option value="ALL">Semua Model Unit</option>
                    {uniqueUnits.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>

                  <select
                    value={remarkFilter}
                    onChange={(e) => {
                      setRemarkFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg px-2.5 text-xs text-slate-200 outline-none transition"
                  >
                    <option value="ALL">Semua Remark</option>
                    <option value="ORDER">ORDER (Stok Rendah)</option>
                    <option value="AMAN">AMAN (Stok Ideal)</option>
                    <option value="OVER">OVER (Stok Lebih)</option>
                  </select>

                  <select
                    value={movementFilter}
                    onChange={(e) => {
                      setMovementFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg px-2.5 text-xs text-slate-200 outline-none transition"
                    title="Filter berdasarkan umur Tanggal Update dari hari ini"
                  >
                    <option value="ALL">Semua Moving ({items.length})</option>
                    <option value="Fast Moving">
                      Fast Moving (&lt; 3 Bln) [{kpi.fastMovingCount}]
                    </option>
                    <option value="Slow Moving">
                      Slow Moving (3–12 Bln) [{kpi.slowMovingCount}]
                    </option>
                    <option value="Dead Moving">
                      Dead Moving (≥ 12 Bln) [{kpi.deadMovingCount}]
                    </option>
                  </select>
                </div>
              </div>

              {/* Row 2: Organized Action Buttons (Reset Data, Google Drive, Import dari CSV, Export dari CSV, & Tambah Barang) */}
              <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* 1. Reset Data */}
                  <button
                    type="button"
                    onClick={() => setIsResetModalOpen(true)}
                    className="h-9 inline-flex items-center gap-2 px-3.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 text-xs font-semibold transition cursor-pointer"
                    title="Kembalikan ke data awal standar (Wajib Password)"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>Reset Data</span>
                  </button>

                  <div className="hidden sm:block h-5 w-px bg-slate-800" />

                  {/* 2. Google Drive Cloud */}
                  <button
                    type="button"
                    onClick={() => setIsGoogleDriveModalOpen(true)}
                    className="h-9 inline-flex items-center gap-2 px-3.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/35 text-blue-200 text-xs font-semibold transition cursor-pointer"
                    title="Simpan & Cadangkan Database ke Google Drive (sebelasirawan@gmail.com)"
                  >
                    <Cloud className="w-4 h-4 text-blue-400 shrink-0" />
                    <span>Google Drive</span>
                    <span className="hidden md:inline font-mono text-[11px] text-blue-300/80">
                      · sebelasirawan@gmail.com
                    </span>
                  </button>

                  <div className="hidden sm:block h-5 w-px bg-slate-800" />

                  {/* 3. Import dari CSV */}
                  <button
                    type="button"
                    onClick={() => setIsImportExcelModalOpen(true)}
                    className="h-9 inline-flex items-center gap-2 px-3.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/35 text-emerald-200 text-xs font-semibold transition cursor-pointer"
                    title="Import data Master Barang dari file CSV (.csv)"
                  >
                    <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Import dari CSV</span>
                  </button>

                  {/* 4. Export dari CSV */}
                  <button
                    type="button"
                    onClick={handleExportInventoryCsv}
                    className="h-9 inline-flex items-center gap-2 px-3.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                    title="Unduh seluruh data Master Barang ke file CSV (.csv)"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Export dari CSV</span>
                  </button>
                </div>

                {/* 5. Primary Action: Tambah Barang */}
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(true)}
                  className="h-9 inline-flex items-center gap-2 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer shadow-sm"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>Tambah Barang</span>
                </button>
              </div>
            </div>

            {/* Master Warehouse Ledger Table (100% faithful to user's CSV structure, supports 3,000+ items with Pagination) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              {/* Top Pagination & Capacity Bar */}
              <div className="px-4 py-3 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 font-mono text-slate-400">
                  <span>
                    Menampilkan{' '}
                    <strong className="text-slate-100">
                      {filteredItems.length === 0
                        ? 0
                        : (safePage - 1) * pageSize + 1}
                      –{Math.min(safePage * pageSize, filteredItems.length)}
                    </strong>{' '}
                    dari{' '}
                    <strong className="text-amber-400">
                      {filteredItems.length.toLocaleString('id-ID')}
                    </strong>{' '}
                    Barang
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-300 font-bold">
                    KAPASITAS 3.000+ ITEM AKTIF
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="text-slate-400 flex items-center gap-1.5">
                    <span>Baris per Halaman:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-amber-300 outline-none"
                    >
                      <option value={50}>50 Item</option>
                      <option value={100}>100 Item</option>
                      <option value={250}>250 Item</option>
                      <option value={500}>500 Item</option>
                      <option value={1000}>1.000 Item</option>
                      <option value={5000}>Semua ({items.length.toLocaleString('id-ID')})</option>
                    </select>
                  </label>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage(1)}
                      className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-300 font-mono text-[11px] cursor-pointer"
                      title="Halaman Pertama"
                    >
                      « Awal
                    </button>
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
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
                      className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      Berikutnya
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setCurrentPage(totalPages)}
                      className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-300 font-mono text-[11px] cursor-pointer"
                      title="Halaman Terakhir"
                    >
                      Akhir »
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/90 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-3 text-center">No</th>
                      <th className="py-3 px-3">Code Item</th>
                      <th className="py-3 px-3">Code Rak</th>
                      <th className="py-3 px-2.5 text-center">Type</th>
                      <th className="py-3 px-3">Model / Code Unit</th>
                      <th className="py-3 px-3">Part Number & Part Name</th>
                      <th className="py-3 px-3">Supplier / Brand</th>
                      <th className="py-3 px-2.5">Tgl Update</th>
                      <th className="py-3 px-2.5 text-right bg-slate-900/60">Awal</th>
                      <th className="py-3 px-2.5 text-right bg-emerald-950/30 text-emerald-400">IN</th>
                      <th className="py-3 px-2 text-right bg-blue-950/20 text-blue-400">(+)</th>
                      <th className="py-3 px-2.5 text-right bg-rose-950/30 text-rose-400">OUT</th>
                      <th className="py-3 px-2 text-right bg-amber-950/20 text-amber-400">(-)</th>
                      <th className="py-3 px-3 text-right bg-slate-950 text-amber-300">Akhir</th>
                      <th className="py-3 px-2.5 text-center">MIN/MAX</th>
                      <th className="py-3 px-2.5 text-center">Remark</th>
                      <th className="py-3 px-3 text-right">Price / Total</th>
                      <th className="py-3 px-3 text-center">Aksi & QR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {paginatedItems.map((item) => {
                      const isHighlighted = highlightedCode === item.codeItem;
                      return (
                        <tr
                          key={item.id}
                          className={`transition duration-300 ${
                            isHighlighted
                              ? 'bg-amber-500/20 ring-1 ring-amber-400'
                              : 'hover:bg-slate-800/50'
                          }`}
                        >
                          <td className="py-3 px-3 text-center font-mono text-slate-400">
                            {item.no}
                          </td>
                          <td className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => {
                                setQrPreviewMode('ITEM_CODE');
                                setQrPreviewItem(item);
                              }}
                              className="font-mono font-bold text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                              title="Klik untuk lihat QR Code Item"
                            >
                              <QrCode className="w-3.5 h-3.5 shrink-0" />
                              {item.codeItem}
                            </button>
                          </td>
                          <td className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => {
                                setQrPreviewMode('RAK');
                                setQrPreviewItem(item);
                              }}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px] flex items-center gap-1 cursor-pointer transition"
                              title="Klik untuk lihat QR Kode Rak"
                            >
                              <QrCode className="w-3 h-3 text-emerald-400 shrink-0" />
                              {item.rak}
                            </button>
                          </td>
                          <td className="py-3 px-2.5 text-center">
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                item.typeCode === 'CNU'
                                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                  : item.typeCode === 'SPT'
                                  ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                                  : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                              }`}
                              title={ITEM_TYPE_LABELS[item.typeCode]?.desc}
                            >
                              {item.typeCode}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-slate-200">{item.modelUnit}</div>
                            <div className="text-[11px] text-slate-400">{item.codeUnit}</div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-100">{item.partName}</div>
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              {parsePartNumbers(item.partNumber).map((pn, pnIdx) => (
                                <button
                                  key={`${item.codeItem}-pn-${pnIdx}`}
                                  type="button"
                                  onClick={() => {
                                    setQrPreviewMode('PART_NUMBER');
                                    setQrPreviewPn(pn);
                                    setQrPreviewItem(item);
                                  }}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold cursor-pointer transition ${
                                    pnIdx === 0
                                      ? 'bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300'
                                      : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300'
                                  }`}
                                  title={`Klik untuk lihat & scan QR Part Number: ${pn}`}
                                >
                                  <QrCode className="w-3 h-3 text-cyan-400 shrink-0" />
                                  {pnIdx === 0 ? pn : `Ref: ${pn}`}
                                </button>
                              ))}
                              {(() => {
                                const mv = calculateMovementStatus(item.tanggalUpdate);
                                return (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border ${
                                      mv === 'Fast Moving'
                                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                        : mv === 'Slow Moving'
                                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                                        : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                    }`}
                                    title={
                                      mv === 'Fast Moving'
                                        ? 'Tanggal Update < 3 bulan dari hari ini (Fast Moving)'
                                        : mv === 'Slow Moving'
                                        ? 'Tanggal Update 3 - 12 bulan dari hari ini (Slow Moving)'
                                        : 'Tanggal Update ≥ 12 bulan dari hari ini (Dead Moving)'
                                    }
                                  >
                                    {mv}
                                  </span>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="text-slate-200 truncate max-w-[150px]">
                              {item.supplier}
                            </div>
                            <div
                              className={`text-[11px] font-mono ${
                                item.brand.includes('Update')
                                  ? 'text-amber-400 font-semibold'
                                  : 'text-slate-400'
                              }`}
                            >
                              {item.brand}
                            </div>
                          </td>
                          <td className="py-3 px-2.5 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                            <div className="font-semibold text-amber-300/90">
                              {formatDateDdMmmmYy(item.tanggalUpdate)}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              In: {formatDateDdMmmmYy(item.tanggalMasuk)}
                            </div>
                          </td>
                          <td className="py-3 px-2.5 text-right font-mono text-slate-300 tabular-nums bg-slate-900/40">
                            {item.awalQty}
                          </td>
                          <td className="py-3 px-2.5 text-right font-mono font-bold text-emerald-400 tabular-nums bg-emerald-950/15">
                            {item.inQty}
                          </td>
                          <td className="py-3 px-2 text-right font-mono text-blue-300 tabular-nums bg-blue-950/10">
                            {item.adjPlusQty}
                          </td>
                          <td className="py-3 px-2.5 text-right font-mono font-bold text-rose-400 tabular-nums bg-rose-950/15">
                            {item.outQty}
                          </td>
                          <td className="py-3 px-2 text-right font-mono text-amber-300 tabular-nums bg-amber-950/10">
                            {item.adjMinusQty}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-sm font-extrabold text-slate-100 tabular-nums bg-slate-950/70">
                            {item.akhirQty}{' '}
                            <span className="text-[10px] font-normal text-slate-400">
                              {item.unit}
                            </span>
                          </td>
                          <td className="py-3 px-2.5 text-center font-mono text-[11px] text-slate-400 tabular-nums">
                            {item.minQty} / {item.maxQty}
                          </td>
                          <td className="py-3 px-2.5 text-center">
                            <span
                              className={`inline-block px-2 py-0.5 rounded font-mono text-[10px] font-extrabold tracking-wide ${
                                item.remark === 'ORDER'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : item.remark === 'AMAN'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              }`}
                            >
                              {item.remark}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {item.price > 0 ? (
                              <>
                                <div className="text-slate-200 font-bold">
                                  {formatRupiah(item.totalValue)}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  @{formatRupiah(item.price)}
                                </div>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditingItem(item)}
                                className="text-[11px] text-amber-400 hover:underline font-semibold cursor-pointer"
                              >
                                {item.priceNote || '(Update Price)'}
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => openScannerForItem(item.codeItem)}
                                className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/30 font-bold text-[11px] transition cursor-pointer"
                                title="Transaksi IN/OUT via Scanner QR"
                              >
                                IN/OUT
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setQrPreviewMode('PART_NUMBER');
                                  setQrPreviewItem(item);
                                }}
                                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 transition cursor-pointer"
                                title="Tampilkan QR Part Number / Code Item / Rak"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingItem(item)}
                                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                                title="Edit Master Barang / Harga"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingItem(item)}
                                className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition cursor-pointer"
                                title="Hapus Item (Wajib Password)"
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

              {/* Bottom Pagination Bar */}
              {totalPages > 1 && (
                <div className="px-4 py-3 bg-slate-950/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="font-mono text-slate-400">
                    Halaman <strong className="text-amber-400">{safePage}</strong> dari{' '}
                    <strong>{totalPages}</strong> ({filteredItems.length.toLocaleString('id-ID')} Total Barang)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Sebelumnya
                    </button>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      Berikutnya
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 2: TERMINAL SCANNER QR (DAILY IN / OUT) */}
        {activeTab === 'SCANNER' && (
          <QrScannerPanel
            items={items}
            preselectedCode={scannerPreselectedCode}
            onClearPreselected={() => setScannerPreselectedCode(null)}
            onSubmitTransaction={handleRecordTransaction}
          />
        )}

        {/* TAB 3: PROSES STOCK OPNAME HARIAN */}
        {activeTab === 'STOCK_OPNAME' && (
          <StockOpnamePanel
            items={items}
            onApplyAdjustments={handleApplyStockOpnameAdjustments}
          />
        )}

        {/* TAB 4: CETAK LABEL QR CODE BARANG & RAK */}
        {activeTab === 'QR_LABELS' && (
          <QrLabelStudio
            items={items}
            onSimulateScanItem={(codeItem) => openScannerForItem(codeItem)}
            onRequestDeleteItem={(item) => setDeletingItem(item)}
          />
        )}

        {/* TAB 4: LOG RIWAYAT TRANSAKSI HARIAN */}
        {activeTab === 'HISTORY' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  Log Transaksi Pemasukan & Pengeluaran Harian Gudang
                </h2>
                <p className="text-xs text-slate-400">
                  Seluruh riwayat pemindaian QR Code & koreksi stok tercatat secara real-time (dapat diunduh & diedit via CSV)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={txSearch}
                    onChange={(e) => setTxSearch(e.target.value)}
                    placeholder="Cari Kode, Nama Part, Petugas..."
                    className="h-9 bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 text-xs text-slate-100 outline-none"
                  />
                </div>
                <select
                  value={txTypeFilter}
                  onChange={(e) => setTxTypeFilter(e.target.value)}
                  className="h-9 bg-slate-950 border border-slate-800 rounded-lg px-3 text-xs text-slate-200 outline-none"
                >
                  <option value="ALL">Semua Jenis Transaksi</option>
                  <option value="IN">Barang Masuk (IN)</option>
                  <option value="OUT">Barang Keluar (OUT)</option>
                  <option value="ADJ_PLUS">Penyesuaian (+)</option>
                  <option value="ADJ_MINUS">Penyesuaian (-)</option>
                </select>

                <div className="hidden sm:block h-5 w-px bg-slate-800" />

                {/* Tombol Edit CSV */}
                <button
                  type="button"
                  onClick={() => setIsLogCsvEditorOpen(true)}
                  className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition cursor-pointer"
                  title="Edit data Log Harian dalam tabel CSV atau upload file CSV hasil edit"
                >
                  <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Edit CSV</span>
                </button>

                {/* Tombol Download CSV */}
                <button
                  type="button"
                  onClick={() => handleDownloadLogHarianCsv(filteredTransactions)}
                  className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-200 text-xs font-bold transition cursor-pointer"
                  title="Download Log Transaksi Harian ke file CSV (.csv)"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download CSV</span>
                </button>

                {filteredTransactions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsBulkDeletingTx(true)}
                    className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-bold transition cursor-pointer"
                    title="Hapus semua log yang tampil (Wajib Password)"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Hapus Log ({filteredTransactions.length})</span>
                  </button>
                )}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              {totalTxPages > 1 && (
                <div className="px-4 py-2.5 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-slate-400">
                    Menampilkan {(safeTxPage - 1) * txPageSize + 1}–
                    {Math.min(safeTxPage * txPageSize, filteredTransactions.length)} dari{' '}
                    <strong className="text-amber-400">
                      {filteredTransactions.length.toLocaleString('id-ID')}
                    </strong>{' '}
                    Log Transaksi
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safeTxPage <= 1}
                      onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 cursor-pointer"
                    >
                      ‹ Sebelumnya
                    </button>
                    <span className="font-mono px-2 text-slate-300">
                      Hal {safeTxPage} / {totalTxPages}
                    </span>
                    <button
                      type="button"
                      disabled={safeTxPage >= totalTxPages}
                      onClick={() => setTxPage((p) => Math.min(totalTxPages, p + 1))}
                      className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 cursor-pointer"
                    >
                      Berikutnya ›
                    </button>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-4">Tanggal / Metode</th>
                      <th className="py-3 px-4">Tipe</th>
                      <th className="py-3 px-4">Code Item & Rak</th>
                      <th className="py-3 px-4">Part Name & PN</th>
                      <th className="py-3 px-4 text-right">Qty Transaksi</th>
                      <th className="py-3 px-4 text-right">Perubahan Stok</th>
                      <th className="py-3 px-4">Nama Mekanik Pengambil</th>
                      <th className="py-3 px-4">Code Unit</th>
                      <th className="py-3 px-4">PIC Logistik</th>
                      <th className="py-3 px-4">Catatan</th>
                      <th className="py-3 px-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {paginatedTransactions.map((tx) => {
                      const { officer, recipient } = splitPicAndRecipient(tx);
                      const matchedMaster = masterItemByCodeMap.get(
                        tx.codeItem.toUpperCase()
                      );
                      const resolvedCodeUnit =
                        tx.unitRef && tx.unitRef.trim() && tx.unitRef.trim() !== '-'
                          ? tx.unitRef
                          : matchedMaster?.codeUnit || matchedMaster?.modelUnit || '-';
                      return (
                        <tr key={tx.id} className="hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                            <div className="font-bold">{formatDateDdMmmmYy(tx.dateStr)}</div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-400">
                              {tx.source === 'QR_SCANNER' ? 'QR SCANNER' : 'ADMIN'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-mono text-xs font-bold ${
                                tx.txType === 'IN'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : tx.txType === 'OUT'
                                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                  : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                              }`}
                            >
                              {tx.txType === 'IN'
                                ? 'MASUK (+IN)'
                                : tx.txType === 'OUT'
                                ? 'KELUAR (-OUT)'
                                : tx.txType === 'ADJ_PLUS'
                                ? 'ADJ (+)'
                                : 'ADJ (-)'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <div className="font-bold text-amber-400">{tx.codeItem}</div>
                            <div className="text-[11px] text-slate-400">Rak: {tx.rak}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-100">{tx.partName}</div>
                            <div className="font-mono text-[11px] text-slate-400">
                              {tx.partNumber} ({tx.typeCode})
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-sm font-extrabold">
                            <span
                              className={
                                tx.txType === 'IN' || tx.txType === 'ADJ_PLUS'
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }
                            >
                              {tx.txType === 'IN' || tx.txType === 'ADJ_PLUS' ? '+' : '-'}
                              {tx.qty} Pcs
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-300">
                            {tx.prevAkhirQty} →{' '}
                            <strong className="text-slate-100">{tx.newAkhirQty} Pcs</strong>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-amber-300">{recipient}</div>
                            <div className="text-[10px] text-slate-500">Mekanik Pengambil</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-mono font-semibold text-cyan-300">
                              {resolvedCodeUnit}
                            </div>
                            <div className="text-[10px] text-slate-500">Code Unit</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-emerald-300">{officer}</div>
                            <div className="text-[10px] text-slate-500">PIC Logistik</div>
                          </td>
                          <td className="py-3 px-4 text-slate-300 max-w-xs">{tx.notes}</td>
                          <td className="py-3 px-4 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setIsLogCsvEditorOpen(true)}
                                className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition cursor-pointer"
                                title="Edit Baris di Editor CSV"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingTx(tx)}
                                className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition cursor-pointer"
                                title="Hapus Log Transaksi Ini (Wajib Password)"
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
            </div>
          </div>
        )}

        {/* TAB 5: PRINT LAPORAN (MASUK / KELUAR • HARIAN / MINGGUAN / BULANAN) */}
        {activeTab === 'PRINT_REPORT' && (
          <PrintReportPanel
            items={items}
            transactions={transactions}
            onUpdateTransaction={handleUpdateTransaction}
          />
        )}
      </main>

      {/* Footer with Company & Author Attribution */}
      <footer className="no-print border-t border-slate-800/80 bg-slate-900/60 py-3.5 px-4 lg:px-6 mt-auto">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-200">PT. Mega Multi Energi</span>
            <span>•</span>
            <span>Sistem Manajemen Gudang & Pemindai QR Real-Time</span>
          </div>
          <div className="font-mono text-xs text-amber-400 font-semibold">
            Author: Irawan
          </div>
        </div>
      </footer>

      {/* Modals */}
      {(isAddModalOpen || editingItem) && (
        <ItemFormModal
          initialItem={editingItem}
          nextNo={items.length > 0 ? Math.max(...items.map((i) => i.no)) + 1 : 1}
          onClose={() => {
            setIsAddModalOpen(false);
            setEditingItem(null);
          }}
          onSave={handleSaveMasterItem}
        />
      )}

      {qrPreviewItem && (
        <QrQuickModal
          item={qrPreviewItem}
          initialMode={qrPreviewMode}
          initialPartNumber={qrPreviewPn}
          onClose={() => {
            setQrPreviewItem(null);
            setQrPreviewPn(undefined);
          }}
          onOpenInScanner={(code) => openScannerForItem(code)}
        />
      )}

      {isImportExcelModalOpen && (
        <ExcelImportModal
          existingCount={items.length}
          onClose={() => setIsImportExcelModalOpen(false)}
          onConfirmImport={handleBulkImportExcel}
        />
      )}

      {deletingItem && (
        <DeleteItemModal
          item={deletingItem}
          onClose={() => setDeletingItem(null)}
          onConfirmDelete={handleDeleteItem}
        />
      )}

      {(deletingTx || isBulkDeletingTx) && (
        <DeleteTransactionModal
          transaction={deletingTx}
          bulkCount={isBulkDeletingTx ? filteredTransactions.length : undefined}
          onClose={() => {
            setDeletingTx(null);
            setIsBulkDeletingTx(false);
          }}
          onConfirmDelete={(revertStock) =>
            handleDeleteTransactions(
              deletingTx ? [deletingTx] : filteredTransactions,
              revertStock
            )
          }
        />
      )}

      {isResetModalOpen && (
        <ResetDataModal
          onClose={() => setIsResetModalOpen(false)}
          onConfirmReset={handleResetToCsvDefault}
        />
      )}

      {isGoogleDriveModalOpen && (
        <GoogleDriveModal
          items={items}
          transactions={transactions}
          onClose={() => setIsGoogleDriveModalOpen(false)}
          onRestoreFromDrive={handleRestoreFromDrive}
        />
      )}

      {isLogCsvEditorOpen && (
        <LogCsvEditorModal
          transactions={transactions}
          items={items}
          onClose={() => setIsLogCsvEditorOpen(false)}
          onSaveTransactions={handleSaveBulkTransactions}
          onDownloadCsv={(txList) => handleDownloadLogHarianCsv(txList)}
        />
      )}
    </div>
  );
}
