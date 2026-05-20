import { isCodeActive } from "./_codes.js";
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

export async function isValidAccessCode(code) {
  if (typeof code !== "string") return false;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return false;

  const overrides = envOverrides();
  if (overrides?.has(normalized)) return true;

  try {
    return await isCodeActive(normalized);
  } catch (err) {
    console.error("Redis lookup failed:", err);
    return false;
  }
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
