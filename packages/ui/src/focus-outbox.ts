import type { StopIntentCommand, TimeCommand } from '@dima/contracts';

export type PendingFocusStop = {
  key: string;
  accountId: string;
  deviceId: string;
  command: StopIntentCommand;
  reportedEndAt: string;
  createdAt: string;
  durable?: boolean;
  phase: 'waiting' | 'personal-review' | 'conflict';
  error?: string;
  reconciliation?: Extract<TimeCommand, { type: 'offlineStop' }>;
};

const databaseName = 'dima-focus-outbox';
const storeName = 'stops';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Local storage is unavailable.')); return; }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: 'key' });
      store.createIndex('scope', ['accountId', 'deviceId']);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'));
    request.onblocked = () => reject(new Error('Close older Dima tabs to update local storage.'));
    request.onsuccess = () => resolve(request.result);
  });
}

export function browserDeviceId(): string {
  const key = 'dima-focus-browser-device';
  const existing = localStorage.getItem(key);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

export function tabControlId(replace = false): string {
  const key = 'dima-focus-tab-control';
  const existing = sessionStorage.getItem(key);
  if (!replace && existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

export function pendingStopKey(accountId: string, deviceId: string, operationId: string) {
  return `${accountId}:${deviceId}:${operationId}`;
}

export async function readPendingStops(accountId: string, deviceId: string): Promise<PendingFocusStop[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).index('scope').getAll(IDBKeyRange.only([accountId, deviceId]));
    request.onsuccess = () => resolve((request.result as PendingFocusStop[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

export async function savePendingStop(value: PendingFocusStop): Promise<void> {
  if (value.key !== pendingStopKey(value.accountId, value.deviceId, value.command.operationId)) throw new Error('Invalid outbox owner.');
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

export async function removePendingStop(accountId: string, deviceId: string, operationId: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(pendingStopKey(accountId, deviceId, operationId));
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

export function exportPendingStops(values: PendingFocusStop[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'dima-pending-focus-stops-v1', stops: values }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'dima-pending-focus-stops.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
