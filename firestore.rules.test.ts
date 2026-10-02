/**
 * Firestore Security Rules Verification Specification (Dirty Dozen Test Suite)
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'delete' | 'get' | 'list';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Inventory Write',
    collection: 'inventory_items/DPS-2105',
    operation: 'create',
    auth: null,
    payload: { id: 'DPS-2105', codeItem: 'DPS-2105' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof Attack',
    collection: 'inventory_items/DPS-2105',
    operation: 'create',
    auth: { uid: 'attacker-1', email: 'sebelasirawan@gmail.com', email_verified: false },
    payload: { id: 'DPS-2105', codeItem: 'DPS-2105' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity Spoofing on Transaction operatorUid',
    collection: 'transactions/TX-001',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { id: 'TX-001', operatorUid: 'user-2', codeItem: 'DPS-2105' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Create',
    collection: 'inventory_items/DPS-2105',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { id: 'DPS-2105', isVerifiedAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow Field Injection on Update',
    collection: 'inventory_items/DPS-2105',
    operation: 'update',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { inQty: 40, ghostField: 'malicious' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Value Poisoning on Whitelisted Key',
    collection: 'inventory_items/DPS-2105',
    operation: 'update',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { inQty: 'NOT_A_NUMBER' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Negative Stock Manipulation',
    collection: 'inventory_items/DPS-2105',
    operation: 'update',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { akhirQty: -50 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'ID Poisoning Attack',
    collection: 'inventory_items/INVALID$ID$WITH$CHARS',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { id: 'INVALID$ID$WITH$CHARS' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Timestamp Forgery on Create',
    collection: 'transactions/TX-002',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { id: 'TX-002', createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Field Mutation (createdAt / codeItem)',
    collection: 'inventory_items/DPS-2105',
    operation: 'update',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { codeItem: 'DPS-9999' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Orphaned Transaction Creation',
    collection: 'transactions/TX-003',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { id: 'TX-003', codeItem: 'DPS-DOES-NOT-EXIST' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Transaction Ledger Tampering (Update)',
    collection: 'transactions/TX-001',
    operation: 'update',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { qty: 9999 },
    expectedResult: 'PERMISSION_DENIED',
  },
];
