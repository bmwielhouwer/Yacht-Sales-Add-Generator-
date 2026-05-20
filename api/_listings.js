import { randomBytes } from "node:crypto";
import { getRedis } from "./_codes.js";

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
  if (!redis) return baseSlug(boatData);
  const base = baseSlug(boatData);
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const reserveKey = `listing:reserve:${slug}`;
    const existing = await redis.get(`listing:${slug}`);
    if (existing) continue;
    const ok = await redis.set(reserveKey, "1", { nx: true, ex: SLUG_TTL_RESERVE });
    if (ok === "OK" || ok === true) return slug;
  }
  return `${base}-${randomSuffix(6)}`;
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
  if (!redis) throw new Error("Upstash Redis is not configured");
  await redis.set(`listing:${slug}`, record);
}

export async function loadListing(slug) {
  const redis = getRedis();
  if (!redis) return null;
  const value = await redis.get(`listing:${slug}`);
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

export async function saveLead(slug, lead) {
  const redis = getRedis();
  if (!redis) throw new Error("Upstash Redis is not configured");
  const ts = new Date().toISOString();
  const key = `lead:${slug}:${ts}-${randomSuffix(6)}`;
  await redis.set(key, { ...lead, slug, created_at: ts });
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
