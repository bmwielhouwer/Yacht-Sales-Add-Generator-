import { checkAccessCode } from "./_lib.js";
import { recordLogin } from "./_codes.js";

const PRICING_URL = "https://marine.compass-line-ventures.com/pricing";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const { code } = req.body ?? {};
  const result = await checkAccessCode(code);
  if (!result.ok) {
    if (result.reason === "revoked") {
      return res
        .status(401)
        .json({ error: "This code has been revoked. Contact support.", reason: "revoked" });
    }
    if (result.reason === "expired") {
      return res.status(401).json({
        error: `Your trial has ended. Choose a plan at ${PRICING_URL}`,
        reason: "expired",
      });
    }
    return res
      .status(401)
      .json({ error: "Invalid code — check your welcome email", reason: "not_found" });
  }

  if (result.record) {
    try {
      await recordLogin(code);
    } catch (err) {
      console.warn("[verify-code] recordLogin failed", err?.message);
    }
  }

  const tier = result.record?.tier ? String(result.record.tier).toUpperCase() : null;
  return res.status(200).json({ ok: true, tier });
}
