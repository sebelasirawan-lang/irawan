# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Authentication & Verification Invariant**: Every read and write operation requires a signed-in user (`request.auth != null`), and all write operations require a verified email (`request.auth.token.email_verified == true`).
2. **Identity Binding Invariant**:
   - On `inventory_items` create/update, `updatedByUid` MUST strictly equal `request.auth.uid`.
   - On `transactions` create, `operatorUid` MUST strictly equal `request.auth.uid`.
3. **Relational Integrity Invariant**:
   - A `WarehouseTransaction` (`/transactions/{txId}`) cannot be created unless its referenced `/inventory_items/$(incoming().codeItem)` exists in Firestore.
4. **Stock Math Invariant**:
   - On `inventory_items`, `akhirQty` must equal `awalQty + inQty + adjPlusQty - outQty - adjMinusQty` and must be `>= 0`.
   - On `transactions`, `txType` must be one of `['IN', 'OUT', 'ADJ_PLUS', 'ADJ_MINUS']` and `qty >= 1`.
5. **Temporal Integrity Invariant**:
   - `createdAt` must equal `request.time` on creation and remain immutable on updates.
   - `updatedAt` must equal `request.time` on creation and updates.
6. **Immutable Transaction Log Invariant**:
   - Once a transaction is recorded in `/transactions/{txId}`, it is an immutable ledger entry (no client updates allowed; only admins can delete if needed).
7. **Query Boundary Invariant**:
   - `list` queries on `/inventory_items` and `/transactions` must explicitly filter by `resource.data.orgId == 'gudang_utama'`.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: Creating an inventory item with `auth == null`.
2. **Unverified Email Spoof**: Attempting admin or write access with `email: "sebelasirawan@gmail.com"` but `email_verified: false`.
3. **Identity Spoofing on Transaction**: Creating a transaction where `operatorUid != request.auth.uid`.
4. **Shadow Field Injection on Create**: Including `isSuperAdmin: true` in `inventory_items` create payload.
5. **Shadow Field Injection on Update**: Modifying an unapproved field or injecting `hacked: 1` during an `inventory_items` update.
6. **Value Poisoning on Whitelisted Key**: Updating `inQty` with a string `"9999"` instead of an integer.
7. **Negative Stock Manipulation**: Updating `akhirQty` to `-10` or breaking the stock balance equation.
8. **ID Poisoning Attack**: Creating a document with a 2000-character ID or invalid characters (`DPS/../../hack`).
9. **Timestamp Forgery**: Providing a past or future client timestamp (`createdAt != request.time`).
10. **Immutable Field Mutation**: Attempting to modify `createdAt` or `codeItem` during an `inventory_items` update.
11. **Orphaned Transaction Creation**: Creating a transaction referencing a non-existent `codeItem` (`DPS-NONEXISTENT`).
12. **Unbounded List Query**: Querying `/inventory_items` without constraining `orgId == 'gudang_utama'`.
