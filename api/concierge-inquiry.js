import { sendConciergeInquiryEmail } from "./_email.js";
import { conciergeRateLimit } from "./_listings.js";

export const config = { maxDuration: 15 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function truncate(s, n) {
  s = String(s ?? "").trim();
  return s.length > n ? s.slice(0, n) : s;
}

export default async function handler(req, res) {
  try {
    return await handleConcierge(req, res);
  } catch (err) {
    console.error("[concierge-inquiry] crash", {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
    });
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: "Server error. Please try again." });
    }
  }
}

async function handleConcierge(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const body = req.body ?? {};
  const name = truncate(body.name, 120);
  const email = truncate(body.email, 200);
  const phone = truncate(body.phone, 60);
  const boatYmm = truncate(body.boatYmm, 200);
  const askingPrice = truncate(body.askingPrice, 60);
  const notes = truncate(body.notes, 5000);

  if (!name) return res.status(400).json({ ok: false, error: "Name is required." });
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: "Valid email is required." });
  }
  if (!boatYmm) {
    return res.status(400).json({ ok: false, error: "Boat year / make / model is required." });
  }
  if (!notes) {
    return res.status(400).json({ ok: false, error: "Broker notes are required." });
  }

  const ip = clientIp(req);
  const { allowed } = await conciergeRateLimit(ip);
  if (!allowed) {
    return res.status(429).json({ ok: false, error: "Too many submissions — try again later." });
  }

  try {
    await sendConciergeInquiryEmail({ name, email, phone, boatYmm, askingPrice, notes });
  } catch (err) {
    console.error("[concierge-inquiry] email send failed", {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
    });
    return res.status(500).json({ ok: false, error: "Couldn't send your inquiry. Please email brianwielhouwer@gmail.com directly." });
  }

  return res.status(200).json({ ok: true });
}
