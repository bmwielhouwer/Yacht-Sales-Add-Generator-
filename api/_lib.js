import { checkCode } from "./_codes.js";
import { readSession } from "./_dashboard.js";

function envOverrides() {
  const raw = process.env.MARINE_ACCESS_CODES;
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
}

function envHas(code) {
  if (typeof code !== "string") return false;
  const overrides = envOverrides();
  if (!overrides) return false;
  return overrides.has(code.trim().toUpperCase());
}

// Returns { ok, reason, record } so callers can show specific messages
// (revoked/expired). Preserves the env-var fallback for legacy test codes
// like CLM-LISTING-12291993 that have no Redis record.
export async function checkAccessCode(code) {
  if (typeof code !== "string" || !code.trim()) {
    return { ok: false, reason: "not_found", record: null };
  }
  try {
    return await checkCode(code, { envOk: envHas(code) });
  } catch (err) {
    console.error("Redis lookup failed:", err);
    if (envHas(code)) return { ok: true, reason: "ok", record: null };
    return { ok: false, reason: "not_found", record: null };
  }
}

export async function isValidAccessCode(code) {
  const result = await checkAccessCode(code);
  return result.ok;
}

export function withGuard(handler, { requireCode = true } = {}) {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "POST only" });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error:
          "ANTHROPIC_API_KEY is not set on this deployment. Add it in Vercel → Project Settings → Environment Variables and redeploy.",
      });
    }
    if (requireCode) {
      const session = readSession(req);
      if (session?.email) {
        req.session = session;
      } else {
        const supplied = req.headers["x-access-code"];
        if (!(await isValidAccessCode(supplied))) {
          return res
            .status(403)
            .json({ error: "Access code required. Refresh the page and re-enter your code." });
        }
      }
    }
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message ?? String(err) });
      }
    }
  };
}
