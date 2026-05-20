import { createHmac, timingSafeEqual } from "node:crypto";
import { getRedis } from "./_codes.js";

const COOKIE_NAME = "clm_dash";
const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;
const BACKFILL_MARKER = "dashboard:backfilled:v1";

export const LEAD_STATUSES = [
  "New",
  "Contacted",
  "Showing Scheduled",
  "Closed-Won",
  "Closed-Lost",
];

export function normalizeEmail(e) {
  return String(e ?? "").trim().toLowerCase();
}

function cookieSecret() {
  const seed =
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.RESEND_API_KEY ||
    "";
  if (!seed) throw new Error("No secret available for cookie signing");
  return seed;
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", cookieSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected;
  try {
    expected = createHmac("sha256", cookieSecret()).update(data).digest("base64url");
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const pair of header.split(/;\s*/)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    out[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
  }
  return out;
}

function cookieAttrs() {
  const isLocal = process.env.VERCEL_ENV === "development" || !process.env.VERCEL_ENV;
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax"];
  if (!isLocal) attrs.push("Secure");
  return attrs;
}

export function setSessionCookie(res, email, extras = {}) {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const payload = { email: normalizeEmail(email), exp };
  if (extras.tier) payload.tier = String(extras.tier).toUpperCase();
  const token = sign(payload);
  const parts = [
    `${COOKIE_NAME}=${token}`,
    ...cookieAttrs(),
    `Max-Age=${COOKIE_TTL_SECONDS}`,
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res) {
  const parts = [`${COOKIE_NAME}=`, ...cookieAttrs(), "Max-Age=0"];
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function readSession(req) {
  const cookies = parseCookies(req);
  return verify(cookies[COOKIE_NAME]);
}

export async function requireSession(req, res) {
  const session = readSession(req);
  if (!session?.email) {
    res.status(401).json({ error: "Not authenticated." });
    return null;
  }
  return session;
}

function extractBrokerEmail(record) {
  return normalizeEmail(
    record?.broker?.email || record?.boatData?.broker?.email || "",
  );
}

function listingCreatedMs(record) {
  const t = Date.parse(record?.created_at ?? "");
  return Number.isFinite(t) ? t : Date.now();
}

function leadCreatedMs(record, key) {
  const t = Date.parse(record?.created_at ?? "");
  if (Number.isFinite(t)) return t;
  const m = String(key ?? "").match(/^lead:[a-z0-9-]+:(.+)$/);
  if (m) {
    const stamp = Date.parse(m[1].replace(/-[a-z0-9]+$/, ""));
    if (Number.isFinite(stamp)) return stamp;
  }
  return Date.now();
}

export async function addListingToBrokerIndex(brokerEmail, slug, createdAtMs) {
  const redis = getRedis();
  if (!redis) return;
  const email = normalizeEmail(brokerEmail);
  if (!email || !slug) return;
  try {
    await redis.zadd(`listings:by-broker:${email}`, {
      score: createdAtMs,
      member: slug,
    });
  } catch (err) {
    console.warn("[dashboard] zadd listings index failed", { email, slug, err: err?.message });
  }
}

export async function addLeadToBrokerIndex(brokerEmail, leadKey, createdAtMs) {
  const redis = getRedis();
  if (!redis) return;
  const email = normalizeEmail(brokerEmail);
  if (!email || !leadKey) return;
  try {
    await redis.zadd(`leads:by-broker:${email}`, {
      score: createdAtMs,
      member: leadKey,
    });
  } catch (err) {
    console.warn("[dashboard] zadd leads index failed", { email, leadKey, err: err?.message });
  }
}

export async function getBrokerListingSlugs(brokerEmail) {
  const redis = getRedis();
  if (!redis) return [];
  const email = normalizeEmail(brokerEmail);
  try {
    const slugs = await redis.zrange(`listings:by-broker:${email}`, 0, -1, { rev: true });
    return Array.isArray(slugs) ? slugs : [];
  } catch (err) {
    console.warn("[dashboard] zrange listings failed", { email, err: err?.message });
    return [];
  }
}

export async function getBrokerLeadKeys(brokerEmail) {
  const redis = getRedis();
  if (!redis) return [];
  const email = normalizeEmail(brokerEmail);
  try {
    const keys = await redis.zrange(`leads:by-broker:${email}`, 0, -1, { rev: true });
    return Array.isArray(keys) ? keys : [];
  } catch (err) {
    console.warn("[dashboard] zrange leads failed", { email, err: err?.message });
    return [];
  }
}

export async function countLeadsForListings(brokerEmail, slugs) {
  const leadKeys = await getBrokerLeadKeys(brokerEmail);
  const counts = Object.create(null);
  for (const s of slugs) counts[s] = 0;
  for (const k of leadKeys) {
    const m = String(k).match(/^lead:([a-z0-9-]+):/);
    if (m && counts[m[1]] !== undefined) counts[m[1]]++;
  }
  return counts;
}

function parseStored(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
    if (safety > 200) {
      console.warn("[dashboard] scan safety break for", pattern);
      break;
    }
  } while (cursor !== "0");
  return out;
}

async function mgetChunked(redis, keys) {
  const out = new Map();
  if (!keys.length) return out;
  const chunk = 50;
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    const values = await redis.mget(...slice);
    slice.forEach((k, j) => out.set(k, parseStored(values?.[j])));
  }
  return out;
}

let backfillPromise = null;
export async function ensureBackfilled() {
  const redis = getRedis();
  if (!redis) return false;
  if (backfillPromise) return backfillPromise;
  backfillPromise = (async () => {
    try {
      const done = await redis.get(BACKFILL_MARKER);
      if (done) return true;
      console.log("[dashboard] starting backfill scan");

      const listingKeys = (await scanKeys(redis, "listing:*")).filter((k) =>
        /^listing:[a-z0-9-]+$/.test(k),
      );
      const listingRecords = await mgetChunked(redis, listingKeys);
      let listingsIndexed = 0;
      for (const [key, record] of listingRecords) {
        if (!record) continue;
        const email = extractBrokerEmail(record);
        if (!email) continue;
        const slug = key.slice("listing:".length);
        await addListingToBrokerIndex(email, slug, listingCreatedMs(record));
        listingsIndexed++;
      }

      const leadKeys = (await scanKeys(redis, "lead:*")).filter((k) =>
        /^lead:[a-z0-9-]+:.+$/.test(k),
      );
      const leadRecords = await mgetChunked(redis, leadKeys);
      const slugToEmail = new Map();
      for (const [key, record] of listingRecords) {
        if (!record) continue;
        const email = extractBrokerEmail(record);
        if (!email) continue;
        slugToEmail.set(key.slice("listing:".length), email);
      }
      let leadsIndexed = 0;
      for (const [key, record] of leadRecords) {
        const m = key.match(/^lead:([a-z0-9-]+):/);
        if (!m) continue;
        const slug = m[1];
        const email = slugToEmail.get(slug);
        if (!email) continue;
        await addLeadToBrokerIndex(email, key, leadCreatedMs(record, key));
        leadsIndexed++;
      }

      await redis.set(BACKFILL_MARKER, "1");
      console.log("[dashboard] backfill complete", {
        listingsIndexed,
        leadsIndexed,
        listingKeysScanned: listingKeys.length,
        leadKeysScanned: leadKeys.length,
      });
      return true;
    } catch (err) {
      console.error("[dashboard] backfill failed", err);
      backfillPromise = null;
      return false;
    }
  })();
  return backfillPromise;
}

export async function loadLead(key) {
  const redis = getRedis();
  if (!redis) return null;
  return parseStored(await redis.get(key));
}

export async function loadLeadsBatch(keys) {
  const redis = getRedis();
  if (!redis || !keys.length) return new Map();
  return mgetChunked(redis, keys);
}

export async function updateLead(key, patch) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis client unavailable");
  const current = await loadLead(key);
  if (!current) throw new Error("Lead not found");
  const next = { ...current };
  if (patch.status !== undefined) {
    if (!LEAD_STATUSES.includes(patch.status)) {
      throw new Error("Invalid status");
    }
    next.status = patch.status;
  }
  if (patch.notes !== undefined) {
    next.notes = String(patch.notes ?? "").slice(0, 4000);
  }
  next.status_updated_at = new Date().toISOString();
  await redis.set(key, next);
  return next;
}
