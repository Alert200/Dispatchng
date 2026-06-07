import { createClient } from "redis";
import dotenv from "dotenv";
dotenv.config();

const client = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
});

client.on("error", (err) => console.error("[Redis] Error:", err));
client.on("connect", () => console.log("[Redis] Connected"));
client.on("reconnecting", () => console.log("[Redis] Reconnecting..."));

await client.connect();

export default client;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Cache a value with optional TTL in seconds */
export async function cacheSet(key, value, ttlSeconds = 300) {
  await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

/** Get a cached value, returns null if missing */
export async function cacheGet(key) {
  const val = await client.get(key);
  return val ? JSON.parse(val) : null;
}

/** Delete a cache key */
export async function cacheDel(key) {
  await client.del(key);
}

/** Publish an event to a channel */
export async function publish(channel, data) {
  await client.publish(channel, JSON.stringify(data));
}
