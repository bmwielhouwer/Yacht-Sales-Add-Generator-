import { randomBytes } from "node:crypto";
import { getRedis } from "./_codes.js";
import {
  addListingToBrokerIndex,
  addLeadToBrokerIndex,
  normalizeEmail,
} from "./_dashboard.js";

const SLUG_TTL_RESERVE = 60 * 30;

function kebab(s) {
  let out = String(s ?? "").toLowerCase();
  try {
    out = out.normalize("NFKD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
  } catch {}
  return out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function randomSuffix(len = 4) {
  const alpha = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alpha[bytes[i] % alpha.length];
  return out;
}

function baseSlug(boatData) {
  const firstName = String(boatData?.broker?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const parts = [boatData?.year, boatData?.make, boatData?.model, firstName]
    .map((p) => kebab(p))
    .filter(Boolean);
  return parts.join("-") || "listing";
}

export async function reserveSlug(boatData) {
  const redis = getRedis();
  if (!redis) {
    const slug = baseSlug(boatData);
    console.log("[listings.reserveSlug] no redis configured, returning base slug:", slug);
    return slug;
  }
  const base = baseSlug(boatData);
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const reserveKey = `listing:reserve:${slug}`;
    const existing = await redis.get(`listing:${slug}`);
    if (existing) {
      console.log("[listings.reserveSlug] collision on", slug, "trying again");
      continue;
    }
    const ok = await redis.set(reserveKey, "1", { nx: true, ex: SLUG_TTL_RESERVE });
    if (ok) {
      console.log("[listings.reserveSlug] reserved", { slug, reserveKey, attempt });
      return slug;
    }
  }
  const slug = `${base}-${randomSuffix(6)}`;
  console.warn("[listings.reserveSlug] exhausted attempts, falling back to", slug);
  return slug;
}

export function getPublicOrigin(req) {
  const env = process.env.PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) return "https://yacht-sales-add-generator.vercel.app";
  return `${proto}://${host}`;
}

export function listingUrl(origin, slug) {
  return `${origin.replace(/\/+$/, "")}/l/${slug}`;
}

export async function saveListing(slug, record) {
  const redis = getRedis();
  if (!redis) {
    throw new Error(
      "Redis client unavailable — set UPSTASH_REDIS_REST_KV_REST_API_URL and UPSTASH_REDIS_REST_KV_REST_API_TOKEN for this environment in Vercel and redeploy",
    );
  }
  const key = `listing:${slug}`;
  const bytes = JSON.stringify(record).length;
  console.log("[listings.saveListing] writing", { key, slug, bytes });
  await redis.set(key, record);
  console.log("[listings.saveListing] write complete", { key });

  const brokerEmail = normalizeEmail(
    record?.broker?.email || record?.boatData?.broker?.email || "",
  );
  if (brokerEmail) {
    const createdMs = Date.parse(record?.created_at ?? "") || Date.now();
    await addListingToBrokerIndex(brokerEmail, slug, createdMs);
  }
}

export const LISTING_STATUSES = ["active", "sale_pending", "sold", "withdrawn"];

export async function loadListing(slug) {
  const redis = getRedis();
  if (!redis) {
    console.warn("[listings.loadListing] no redis configured for slug", slug);
    return null;
  }
  const key = `listing:${slug}`;
  console.log("[listings.loadListing] reading", { key, slug });
  const value = await redis.get(key);
  if (!value) {
    console.warn("[listings.loadListing] miss for key", key);
    return null;
  }
  let record = value;
  if (typeof value !== "object") {
    try {
      record = JSON.parse(value);
    } catch (err) {
      console.error("[listings.loadListing] failed to parse value for", key, err);
      return null;
    }
  }
  if (record && typeof record === "object" && !record.status) {
    record.status = "active";
    redis
      .set(key, record)
      .catch((err) =>
        console.warn("[listings.loadListing] status backfill write failed", {
          key,
          err: err?.message,
        }),
      );
  }
  return record;
}

export async function bumpViewCount(slug) {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    return await redis.incr(`listing:${slug}:views`);
  } catch {
    return 0;
  }
}

export async function getViewCount(slug) {
  const redis = getRedis();
  if (!redis) return 0;
  const v = await redis.get(`listing:${slug}:views`);
  return Number(v) || 0;
}

export async function saveLead(slug, lead, brokerEmail = null) {
  const redis = getRedis();
  if (!redis) {
    throw new Error(
      "Redis client unavailable — set UPSTASH_REDIS_REST_KV_REST_API_URL and UPSTASH_REDIS_REST_KV_REST_API_TOKEN for this environment in Vercel and redeploy",
    );
  }
  const ts = new Date().toISOString();
  const key = `lead:${slug}:${ts}-${randomSuffix(6)}`;
  await redis.set(key, { ...lead, slug, created_at: ts, status: "New", notes: "" });
  const email = normalizeEmail(brokerEmail);
  if (email) {
    await addLeadToBrokerIndex(email, key, Date.parse(ts) || Date.now());
  }
  return key;
}

export async function inquiryRateLimit(ip, max = 5, windowSec = 3600) {
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: max };
  const key = `inquiry:rl:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return { allowed: count <= max, remaining: Math.max(0, max - count) };
}

export async function conciergeRateLimit(ip, max = 5, windowSec = 3600) {
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: max };
  const key = `concierge:rl:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return { allowed: count <= max, remaining: Math.max(0, max - count) };
}
