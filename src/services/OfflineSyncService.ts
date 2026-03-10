/**
 * Serviço de sincronização offline.
 * Enfileira operações quando offline e envia ao Supabase quando online.
 * Cache local em AsyncStorage para leitura offline.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const SYNC_QUEUE_KEY = '@agrocota_sync_queue';
const CACHE_PREFIX = '@agrocota_cache_';

export type SyncOp = {
  id: string;
  table: string;
  op: 'insert' | 'update' | 'delete' | 'upsert';
  payload: Record<string, unknown>;
  where?: Record<string, unknown>;
  createdAt: string;
};

async function getQueue(): Promise<SyncOp[]> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: SyncOp[]) {
  await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueSync(op: Omit<SyncOp, 'id' | 'createdAt'>) {
  const queue = await getQueue();
  queue.push({
    ...op,
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
  });
  await saveQueue(queue);
}

export async function getPendingCount(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

export async function flushSyncQueue(): Promise<{ success: number; failed: number }> {
  const queue = await getQueue();
  if (queue.length === 0) return { success: 0, failed: 0 };

  let success = 0;
  let failed = 0;
  const remaining: SyncOp[] = [];

  for (const op of queue) {
    try {
      if (op.op === 'insert') {
        const { error } = await supabase.from(op.table).insert(op.payload);
        if (error) throw error;
      } else if (op.op === 'update' && op.where) {
        let q = supabase.from(op.table).update(op.payload);
        for (const [k, v] of Object.entries(op.where)) {
          q = q.eq(k, v);
        }
        const { error } = await q;
        if (error) throw error;
      } else if (op.op === 'delete' && op.where) {
        let q = supabase.from(op.table).delete();
        for (const [k, v] of Object.entries(op.where)) {
          q = q.eq(k, v);
        }
        const { error } = await q;
        if (error) throw error;
      } else if (op.op === 'upsert') {
        const { error } = await supabase.from(op.table).upsert(op.payload);
        if (error) throw error;
      }
      success++;
    } catch (e) {
      console.warn('[OfflineSync] Erro ao sincronizar:', op.table, op.op, e);
      failed++;
      remaining.push(op);
    }
  }

  await saveQueue(remaining);
  return { success, failed };
}

export async function setCache<T>(key: string, data: T, ttlMs?: number) {
  const entry = {
    data,
    ts: Date.now(),
    ttl: ttlMs ?? 24 * 60 * 60 * 1000,
  };
  await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, ts, ttl } = JSON.parse(raw);
    if (Date.now() - ts > ttl) return null;
    return data as T;
  } catch {
    return null;
  }
}
