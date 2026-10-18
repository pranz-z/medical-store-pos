/**
 * Held carts — persisted per terminal in IndexedDB (spec §6.1.6 park/resume).
 *
 * Held carts are advisory only: they store product/unit ids and quantities,
 * never prices or totals, and checkout always re-prices and re-validates
 * server-side. A successful checkout deletes its held cart.
 */

const DB_NAME = "medical-store-pos";
const STORE = "held-carts";

export interface HeldCartLine {
  productId: string;
  unitId: string;
  /** Quantity in the chosen unit, as the cashier typed it. */
  qtyUnits: number;
  discountMinor: number;
}

export interface HeldCart {
  id: string;
  label: string;
  lines: HeldCartLine[];
  cartDiscountMinor: number;
  heldAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function listHeldCarts(): Promise<HeldCart[]> {
  const carts = await withStore("readonly", (store) => store.getAll() as IDBRequest<HeldCart[]>);
  return carts.sort((a, b) => b.heldAt - a.heldAt);
}

export async function holdCart(cart: HeldCart): Promise<void> {
  await withStore("readwrite", (store) => store.put(cart));
}

export async function deleteHeldCart(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
