import { Redis } from '@upstash/redis';

let memory: Record<string, any[]> | null = null;

export const kv = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! })
  : null;

export async function pushResult(sessionId: string, payload: any) {
  if (!sessionId) return;
  if (kv) {
    return kv.rpush(`transcripts:${sessionId}`, JSON.stringify(payload));
  }
  if (!memory) memory = {};
  (memory[sessionId] ||= []).push(payload);
}

export async function popAll(sessionId: string) {
  if (!sessionId) return [];
  if (kv) {
    const key = `transcripts:${sessionId}`;
    const len = await kv.llen(key);
    if (!len) return [];
    const items = await kv.lrange<string>(key, 0, len - 1);
    await kv.del(key);
    return items.map((item) => {
      try {
        return JSON.parse(item);
      } catch (err) {
        console.warn('[manual-transcript] Failed to parse KV item', err);
        return null;
      }
    }).filter(Boolean);
  }
  if (!memory) memory = {};
  const items = memory[sessionId] || [];
  memory[sessionId] = [];
  return items;
}
