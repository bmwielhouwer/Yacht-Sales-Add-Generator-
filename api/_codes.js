import { Redis } from "@upstash/redis";
import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

let _redis = null;
export function getRedis() {
  if (_redis) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  _redis = Redis.fromEnv();
  return _redis;
}

export function generateAccessCode(tier) {
  const bytes = randomBytes(6);
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += ALPHABET[bytes[i] % ALPHABET.length];
  return `CLM-${tier}-${suffix}`;
}

export const TIER_BY_AMOUNT_CENTS = {
  4900: "LISTING",
  25000: "STUDIO",
  39900: "SUITE",
};

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

export async function lookupCode(code) {
  const redis = getRedis();
  if (!redis) return null;
  return parseStored(await redis.get(`code:${code}`));
}

export async function isCodeActive(code) {
  const record = await lookupCode(code);
  return record?.active === true;
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
  const data = {
    tier,
    customer_email: customerEmail,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId ?? null,
    active: true,
    created_at: new Date().toISOString(),
    generations_used: 0,
  };
  await redis.set(`code:${code}`, data);
  if (stripeSubscriptionId) {
    await redis.set(`sub:${stripeSubscriptionId}`, code);
  }
}

export async function deactivateCodeBySubscription(stripeSubscriptionId) {
  const redis = getRedis();
  if (!redis) throw new Error("Upstash Redis is not configured");
  const code = await redis.get(`sub:${stripeSubscriptionId}`);
  if (!code) return null;
  const record = parseStored(await redis.get(`code:${code}`));
  if (!record) return null;
  record.active = false;
  record.deactivated_at = new Date().toISOString();
  await redis.set(`code:${code}`, record);
  return code;
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
