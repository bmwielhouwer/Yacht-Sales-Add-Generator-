import { isValidAccessCode } from "./_lib.js";
import { lookupCode } from "./_codes.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const { code } = req.body ?? {};
  if (!(await isValidAccessCode(code))) {
    return res.status(401).json({ error: "Invalid code — check your welcome email" });
  }
  const record = await lookupCode(String(code ?? "").trim().toUpperCase());
  const tier = record?.tier ? String(record.tier).toUpperCase() : null;
  return res.status(200).json({ ok: true, tier });
}
