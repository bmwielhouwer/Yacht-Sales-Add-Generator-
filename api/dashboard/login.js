import { isValidAccessCode } from "../_lib.js";
import { lookupCode } from "../_codes.js";
import { setSessionCookie, normalizeEmail } from "../_dashboard.js";

export const config = { maxDuration: 10 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  try {
    const body = req.body ?? {};
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? "").trim().toUpperCase();

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email." });
    }
    if (!code) {
      return res.status(400).json({ error: "Enter your access code." });
    }

    const valid = await isValidAccessCode(code);
    if (!valid) {
      return res.status(401).json({ error: "Invalid access code." });
    }

    const record = await lookupCode(code);
    const codeEmail = normalizeEmail(record?.customer_email);
    if (codeEmail && codeEmail !== email) {
      console.warn("[dashboard.login] email mismatch", { entered: email, onCode: codeEmail });
      return res.status(401).json({
        error: "Email doesn't match the one on this access code.",
      });
    }

    setSessionCookie(res, email);
    return res.status(200).json({ ok: true, email });
  } catch (err) {
    console.error("[dashboard.login] crash", err);
    return res.status(500).json({ error: err?.message ?? "Internal error" });
  }
}
