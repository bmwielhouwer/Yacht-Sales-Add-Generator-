import { isValidAccessCode } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!process.env.MARINE_ACCESS_CODES) {
    return res.status(500).json({
      error:
        "MARINE_ACCESS_CODES is not set on this deployment. Add it in Vercel → Project Settings → Environment Variables and redeploy.",
    });
  }
  const { code } = req.body ?? {};
  if (isValidAccessCode(code)) {
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ error: "Invalid code — check your welcome email" });
}
