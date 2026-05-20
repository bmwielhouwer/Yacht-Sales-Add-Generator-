import {
  getRedis,
  listAllCodes,
  createAdminCode,
  revokeCode,
  extendCode,
  VALID_TIERS,
} from "../_codes.js";
import {
  setAdminCookie,
  clearAdminCookie,
  readAdminSession,
  requireAdmin,
  checkAdminPassword,
} from "../_admin.js";

export const config = { maxDuration: 15 };

function isIsoDate(s) {
  if (typeof s !== "string" || !s) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

async function loginHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!process.env.ADMIN_PASSWORD) {
    return res
      .status(500)
      .json({ error: "ADMIN_PASSWORD is not set on this deployment." });
  }
  const password = req.body?.password;
  if (!checkAdminPassword(password)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  setAdminCookie(res);
  return res.status(200).json({ ok: true });
}

async function logoutHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  clearAdminCookie(res);
  return res.status(200).json({ ok: true });
}

async function meHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const session = readAdminSession(req);
  if (!session || session.role !== "admin") {
    return res.status(401).json({ authenticated: false });
  }
  return res.status(200).json({ authenticated: true, exp: session.exp });
}

async function listCodesHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  if (!requireAdmin(req, res)) return;
  if (!getRedis()) {
    return res.status(500).json({ error: "Redis client unavailable on this deployment." });
  }
  const codes = await listAllCodes({ limit: 1000 });
  return res.status(200).json({ codes });
}

async function generateCodeHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!requireAdmin(req, res)) return;
  if (!getRedis()) {
    return res.status(500).json({ error: "Redis client unavailable on this deployment." });
  }

  const body = req.body ?? {};
  const tier = String(body.tier ?? "").toUpperCase();
  if (!VALID_TIERS.includes(tier)) {
    return res.status(400).json({ error: "Invalid tier." });
  }
  const shopName = body.shopName ? String(body.shopName).trim() : null;
  const brokerName = body.brokerName ? String(body.brokerName).trim() : null;

  let expiresAt = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    if (!isIsoDate(body.expiresAt)) {
      return res.status(400).json({ error: "Invalid expiration date." });
    }
    expiresAt = new Date(body.expiresAt).toISOString();
  }

  const record = await createAdminCode({
    tier,
    shopName,
    brokerName,
    expiresAt,
  });
  return res.status(200).json({ ok: true, code: record });
}

async function revokeCodeHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!requireAdmin(req, res)) return;
  if (!getRedis()) {
    return res.status(500).json({ error: "Redis client unavailable on this deployment." });
  }
  const code = String(req.body?.code ?? "").trim();
  if (!code) return res.status(400).json({ error: "code required" });
  const record = await revokeCode(code);
  if (!record) return res.status(404).json({ error: "Code not found." });
  return res.status(200).json({ ok: true, code: record });
}

async function extendCodeHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!requireAdmin(req, res)) return;
  if (!getRedis()) {
    return res.status(500).json({ error: "Redis client unavailable on this deployment." });
  }
  const code = String(req.body?.code ?? "").trim();
  if (!code) return res.status(400).json({ error: "code required" });

  let expiresAt = null;
  if (
    req.body?.expiresAt !== undefined &&
    req.body?.expiresAt !== null &&
    req.body?.expiresAt !== ""
  ) {
    if (!isIsoDate(req.body.expiresAt)) {
      return res.status(400).json({ error: "Invalid expiration date." });
    }
    expiresAt = new Date(req.body.expiresAt).toISOString();
  }

  const record = await extendCode(code, expiresAt);
  if (!record) return res.status(404).json({ error: "Code not found." });
  return res.status(200).json({ ok: true, code: record });
}

const ACTIONS = {
  login: loginHandler,
  logout: logoutHandler,
  me: meHandler,
  "list-codes": listCodesHandler,
  "generate-code": generateCodeHandler,
  "revoke-code": revokeCodeHandler,
  "extend-code": extendCodeHandler,
};

export default async function handler(req, res) {
  const action = String(req.query?.action ?? "").trim();
  const fn = ACTIONS[action];
  if (!fn) {
    return res.status(404).json({ error: `Unknown admin action: ${action}` });
  }
  try {
    return await fn(req, res);
  } catch (err) {
    console.error(`[admin.${action}] crash`, err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  }
}
