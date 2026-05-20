import { Redis } from "@upstash/redis";
import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODES_INDEX_KEY = "codes:all";

let _redis = null;
let _redisLogged = false;
export function getRedis() {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;

  if (!url || !token) {
    if (!_redisLogged) {
      _redisLogged = true;
      console.warn("[redis] no client — env vars not found", {
        UPSTASH_REDIS_REST_KV_REST_API_URL: url ? "set" : "missing",
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: token ? "set" : "missing",
        VERCEL_ENV: process.env.VERCEL_ENV ?? "unknown",
      });
    }
    return null;
  }

  _redis = new Redis({ url, token });
  if (!_redisLogged) {
    _redisLogged = true;
    console.log("[redis] client ready", { VERCEL_ENV: process.env.VERCEL_ENV ?? "unknown" });
  }
  return _redis;
}

function randomChars(n) {
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function generateAccessCode(tier) {
  return `CLM-${tier}-${randomChars(6)}`;
}

export function shopSlug(shopName) {
  if (!shopName) return "GEN";
  const cleaned = String(shopName)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "GEN";
  return cleaned.slice(0, 4).padEnd(4, "X");
}

export function generateAdminCode(tier, shopName) {
  return `CLM-${tier}-${shopSlug(shopName)}-${randomChars(4)}`;
}

export const TIER_BY_AMOUNT_CENTS = {
  4900: "LISTING",
  25000: "STUDIO",
  39900: "SUITE",
};

export const VALID_TIERS = ["LISTING", "STUDIO", "SUITE"];

export function tierFromAmount(cents) {
  const tier = TIER_BY_AMOUNT_CENTS[cents];
  if (!tier) throw new Error(`Unknown checkout amount: ${cents} cents`);
  return tier;
}

function parseStored(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function normalizeCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

function isExpired(record) {
  if (!record?.expires_at) return false;
  const exp = Date.parse(record.expires_at);
  if (!Number.isFinite(exp)) return false;
  return exp < Date.now();
}

function normalizeRecord(record) {
  if (!record) return null;
  const out = { ...record };
  if (out.status == null) {
    out.status = out.active === false ? "revoked" : "active";
  }
  if (out.source == null) {
    out.source = out.stripe_customer_id ? "stripe" : "admin";
  }
  if (out.expires_at === undefined) out.expires_at = null;
  if (out.shop_name === undefined) out.shop_name = null;
  if (out.broker_name === undefined) out.broker_name = null;
  if (out.broker_email === undefined) {
    out.broker_email = out.customer_email ?? null;
  }
  if (out.last_used_at === undefined) out.last_used_at = null;
  if (out.login_count == null) out.login_count = 0;
  return out;
}

export async function lookupCode(code) {
  const redis = getRedis();
  if (!redis) return null;
  const raw = parseStored(await redis.get(`code:${normalizeCode(code)}`));
  return normalizeRecord(raw);
}

export async function isCodeActive(code) {
  const record = await lookupCode(code);
  if (!record) return false;
  if (record.status === "revoked") return false;
  if (record.status === "expired") return false;
  if (isExpired(record)) return false;
  if (record.active === false) return false;
  return true;
}

async function indexCode(redis, code, createdAt) {
  try {
    const score = Date.parse(createdAt) || Date.now();
    await redis.zadd(CODES_INDEX_KEY, { score, member: code });
  } catch (err) {
    console.warn("[codes] zadd index failed", { code, err: err?.message });
  }
}

export async function saveNewCode({
  code,
  tier,
  customerEmail,
  stripeCustomerId,
  stripeSubscriptionId,
}) {
  const redis = getRedis();
  if (!redis) throw new Error("Upstash Redis is not configured");
  const now = nowIso();
  const data = {
    code,
    tier,
    shop_name: null,
    broker_name: null,
    broker_email: customerEmail ?? null,
    customer_email: customerEmail,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId ?? null,
    active: true,
    status: "active",
    source: "stripe",
    created_at: now,
    expires_at: null,
    last_used_at: null,
    login_count: 0,
    generations_used: 0,
  };
  await redis.set(`code:${code}`, data);
  await indexCode(redis, code, now);
  if (stripeSubscriptionId) {
    await redis.set(`sub:${stripeSubscriptionId}`, code);
  }
}

export async function createAdminCode({
  tier,
  shopName,
  brokerName,
  expiresAt,
  source = "admin",
}) {
  const redis = getRedis();
  if (!redis) throw new Error("Upstash Redis is not configured");
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateAdminCode(tier, shopName);
    const existing = await redis.get(`code:${candidate}`);
    if (!existing) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error("Could not allocate unique code");

  const now = nowIso();
  const data = {
    code,
    tier,
    shop_name: shopName || null,
    broker_name: brokerName || null,
    broker_email: null,
    active: true,
    status: "active",
    source,
    created_at: now,
    expires_at: expiresAt ?? null,
    last_used_at: null,
    login_count: 0,
    generations_used: 0,
  };
  await redis.set(`code:${code}`, data);
  await indexCode(redis, code, now);
  return data;
}

export async function deactivateCodeBySubscription(stripeSubscriptionId) {
  const redis = getRedis();
  if (!redis) throw new Error("Upstash Redis is not configured");
  const code = await redis.get(`sub:${stripeSubscriptionId}`);
  if (!code) return null;
  const record = normalizeRecord(parseStored(await redis.get(`code:${code}`)));
  if (!record) return null;
  record.active = false;
  record.status = "revoked";
  record.deactivated_at = nowIso();
  await redis.set(`code:${code}`, record);
  return code;
}

export async function revokeCode(code) {
  const redis = getRedis();
  if (!redis) throw new Error("Upstash Redis is not configured");
  const normalized = normalizeCode(code);
  const record = normalizeRecord(parseStored(await redis.get(`code:${normalized}`)));
  if (!record) return null;
  record.active = false;
  record.status = "revoked";
  record.revoked_at = nowIso();
  await redis.set(`code:${normalized}`, record);
  return record;
}

export async function extendCode(code, expiresAt) {
  const redis = getRedis();
  if (!redis) throw new Error("Upstash Redis is not configured");
  const normalized = normalizeCode(code);
  const record = normalizeRecord(parseStored(await redis.get(`code:${normalized}`)));
  if (!record) return null;
  record.expires_at = expiresAt ?? null;
  if (record.status === "expired") {
    record.status = "active";
    record.active = true;
  }
  await redis.set(`code:${normalized}`, record);
  return record;
}

async function persistExpiredStatus(code, record) {
  const redis = getRedis();
  if (!redis) return;
  if (record.status === "expired") return;
  record.status = "expired";
  record.active = false;
  try {
    await redis.set(`code:${code}`, record);
  } catch (err) {
    console.warn("[codes] persist expired status failed", { code, err: err?.message });
  }
}

// Returns { ok, reason, record } where reason is one of:
//   "ok" | "not_found" | "revoked" | "expired"
// `envOk` lets callers honor the MARINE_ACCESS_CODES env fallback for
// legacy test codes that have no Redis record.
export async function checkCode(code, { envOk = false } = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, reason: "not_found", record: null };

  const record = await lookupCode(normalized);
  if (!record) {
    if (envOk) return { ok: true, reason: "ok", record: null };
    return { ok: false, reason: "not_found", record: null };
  }
  if (record.status === "revoked") {
    return { ok: false, reason: "revoked", record };
  }
  if (isExpired(record)) {
    await persistExpiredStatus(normalized, record);
    return { ok: false, reason: "expired", record };
  }
  return { ok: true, reason: "ok", record };
}

export async function recordLogin(code, { brokerEmail } = {}) {
  const redis = getRedis();
  if (!redis) return null;
  const normalized = normalizeCode(code);
  const record = normalizeRecord(parseStored(await redis.get(`code:${normalized}`)));
  if (!record) return null;
  record.last_used_at = nowIso();
  record.login_count = Number(record.login_count || 0) + 1;
  if (brokerEmail && !record.broker_email) {
    record.broker_email = String(brokerEmail).trim().toLowerCase();
  }
  try {
    await redis.set(`code:${normalized}`, record);
  } catch (err) {
    console.warn("[codes] recordLogin write failed", { code: normalized, err: err?.message });
  }
  return record;
}

async function scanKeys(redis, pattern) {
  const out = [];
  let cursor = "0";
  let safety = 0;
  do {
    const result = await redis.scan(cursor, { match: pattern, count: 200 });
    const next = Array.isArray(result) ? result[0] : result?.cursor;
    const keys = Array.isArray(result) ? result[1] : result?.keys;
    if (Array.isArray(keys)) out.push(...keys);
    cursor = String(next ?? "0");
    safety++;
    if (safety > 200) break;
  } while (cursor !== "0");
  return out;
}

const CODES_BACKFILL_MARKER = "codes:backfilled:v1";
let _codesBackfillPromise = null;
export async function ensureCodesBackfilled() {
  const redis = getRedis();
  if (!redis) return false;
  if (_codesBackfillPromise) return _codesBackfillPromise;
  _codesBackfillPromise = (async () => {
    try {
      const done = await redis.get(CODES_BACKFILL_MARKER);
      if (done) return true;
      const keys = (await scanKeys(redis, "code:*")).filter((k) => /^code:CLM-/.test(k));
      let indexed = 0;
      for (let i = 0; i < keys.length; i += 50) {
        const slice = keys.slice(i, i + 50);
        const values = await redis.mget(...slice);
        for (let j = 0; j < slice.length; j++) {
          const rec = parseStored(values?.[j]);
          if (!rec) continue;
          const code = slice[j].slice("code:".length);
          await indexCode(redis, code, rec.created_at);
          indexed++;
        }
      }
      await redis.set(CODES_BACKFILL_MARKER, "1");
      console.log("[codes] backfill complete", { indexed, scanned: keys.length });
      return true;
    } catch (err) {
      console.error("[codes] backfill failed", err);
      _codesBackfillPromise = null;
      return false;
    }
  })();
  return _codesBackfillPromise;
}

export async function listAllCodes({ limit = 500 } = {}) {
  const redis = getRedis();
  if (!redis) return [];
  await ensureCodesBackfilled();
  let codes = [];
  try {
    codes = await redis.zrange(CODES_INDEX_KEY, 0, limit - 1, { rev: true });
  } catch (err) {
    console.warn("[codes] zrange failed", err?.message);
    return [];
  }
  if (!Array.isArray(codes) || !codes.length) return [];
  const keys = codes.map((c) => `code:${c}`);
  const records = [];
  const CHUNK = 50;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const values = await redis.mget(...slice);
    slice.forEach((k, j) => {
      const rec = normalizeRecord(parseStored(values?.[j]));
      if (rec) {
        if (isExpired(rec) && rec.status === "active") {
          rec.status = "expired";
          rec.active = false;
        }
        records.push(rec);
      }
    });
  }
  return records;
}

export async function getSessionResult(sessionId) {
  const redis = getRedis();
  if (!redis) return null;
  return (await redis.get(`session:${sessionId}`)) ?? null;
}

export async function markSessionProcessed(sessionId, code) {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(`session:${sessionId}`, code);
}
