import type { ChatMessage, Thread } from './types';

const DB_NAME = 'kiln';
const STORE = 'threads';

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as ChatMessage;
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    typeof message.createdAt === 'number'
  );
}

function isThread(value: unknown): value is Thread {
  if (!value || typeof value !== 'object') return false;
  const thread = value as Thread;
  return (
    typeof thread.id === 'string' &&
    typeof thread.title === 'string' &&
    typeof thread.createdAt === 'number' &&
    typeof thread.updatedAt === 'number' &&
    Array.isArray(thread.messages) &&
    thread.messages.every(isMessage)
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local database'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local database request failed'));
  });
}

export async function listThreads(): Promise<Thread[]> {
  const db = await openDb();
  try {
    const rows = await requestToPromise(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll(),
    );
    return rows.filter(isThread).sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function saveThread(thread: Thread): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(thread);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the chat'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving the chat was aborted'));
    });
  } finally {
    db.close();
  }
}

export async function deleteThread(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not delete the chat'));
      tx.onabort = () => reject(tx.error ?? new Error('Deleting the chat was aborted'));
    });
  } finally {
    db.close();
  }
}
