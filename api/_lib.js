function validCodes() {
  const raw = process.env.MARINE_ACCESS_CODES;
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
}

export function isValidAccessCode(code) {
  const codes = validCodes();
  if (!codes) return false;
  if (typeof code !== "string") return false;
  return codes.has(code.trim().toUpperCase());
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
      const codes = validCodes();
      if (!codes) {
        return res.status(500).json({
          error:
            "MARINE_ACCESS_CODES is not set on this deployment. Add it in Vercel → Project Settings → Environment Variables and redeploy.",
        });
      }
      const supplied = req.headers["x-access-code"];
      if (!isValidAccessCode(supplied)) {
        return res
          .status(403)
          .json({ error: "Access code required. Refresh the page and re-enter your code." });
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
