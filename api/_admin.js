import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "clm_admin";
const COOKIE_TTL_SECONDS = 60 * 60 * 24; // 24 hours

function cookieSecret() {
  const seed =
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.RESEND_API_KEY ||
    process.env.ADMIN_PASSWORD ||
    "";
  if (!seed) throw new Error("No secret available for admin cookie signing");
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
  const attrs = ["Path=/", "HttpOnly", "SameSite=Strict"];
  if (!isLocal) attrs.push("Secure");
  return attrs;
}

export function setAdminCookie(res) {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const token = sign({ role: "admin", exp });
  const parts = [
    `${COOKIE_NAME}=${token}`,
    ...cookieAttrs(),
    `Max-Age=${COOKIE_TTL_SECONDS}`,
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearAdminCookie(res) {
  const parts = [`${COOKIE_NAME}=`, ...cookieAttrs(), "Max-Age=0"];
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function readAdminSession(req) {
  const cookies = parseCookies(req);
  return verify(cookies[COOKIE_NAME]);
}

export function requireAdmin(req, res) {
  const session = readAdminSession(req);
  if (!session || session.role !== "admin") {
    res.status(401).json({ error: "Admin authentication required." });
    return null;
  }
  return session;
}

// Constant-time string compare against ADMIN_PASSWORD env var.
export function checkAdminPassword(supplied) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  if (typeof supplied !== "string" || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
