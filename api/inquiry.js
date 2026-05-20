import { loadListing, saveLead, inquiryRateLimit, listingUrl, getPublicOrigin } from "./_listings.js";
import { sendInquiryEmail } from "./_email.js";

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
    return await handleInquiry(req, res);
  } catch (err) {
    console.error("[inquiry] crash", {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
    });
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ error: err?.message ? `inquiry: ${err.message}` : "Internal error" });
    }
  }
}

async function handleInquiry(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const body = req.body ?? {};
  const slug = String(body.slug ?? "").trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Invalid listing." });
  }

  const name = truncate(body.name, 120);
  const email = truncate(body.email, 200);
  const phone = truncate(body.phone, 60);
  const message = truncate(body.message, 2000);

  if (!name) return res.status(400).json({ error: "Name is required." });
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Valid email is required." });
  }

  const ip = clientIp(req);
  const { allowed } = await inquiryRateLimit(ip);
  if (!allowed) {
    return res.status(429).json({ error: "Too many submissions — try again later." });
  }

  const listingRecord = await loadListing(slug);
  if (!listingRecord) {
    return res.status(404).json({ error: "Listing not found." });
  }

  const lead = {
    name,
    email,
    phone: phone || null,
    message: message || null,
    cash_buyer: !!body.cash_buyer,
    trade_in: !!body.trade_in,
    financing: !!body.financing,
    ip,
    user_agent: truncate(req.headers["user-agent"], 300),
  };

  try {
    await saveLead(slug, lead);
  } catch (err) {
    console.error("saveLead failed", err);
    return res.status(500).json({ error: "Could not save inquiry." });
  }

  const broker = listingRecord.broker || listingRecord.boatData?.broker || {};
  const boatName =
    listingRecord.flier?.boatName ||
    [listingRecord.boatData?.year, listingRecord.boatData?.make, listingRecord.boatData?.model]
      .filter(Boolean)
      .join(" ");
  const url = listingRecord.listingUrl || listingUrl(getPublicOrigin(req), slug);

  try {
    await sendInquiryEmail({
      broker,
      lead,
      listing: { boatName, url },
    });
  } catch (err) {
    console.error("sendInquiryEmail failed", err);
  }

  const firstName = String(broker?.name ?? "").trim().split(/\s+/)[0] || "The broker";
  return res.status(200).json({
    ok: true,
    message: `Thanks! ${firstName} will reach out within a few hours.`,
  });
}
