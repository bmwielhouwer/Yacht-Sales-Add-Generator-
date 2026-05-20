import { del } from "@vercel/blob";
import { getRedis, lookupCode } from "../_codes.js";
import { isValidAccessCode } from "../_lib.js";
import { loadListing, listingUrl, getPublicOrigin } from "../_listings.js";
import {
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireSession,
  ensureBackfilled,
  getBrokerListingSlugs,
  getBrokerLeadKeys,
  countLeadsForListings,
  loadLeadsBatch,
  updateLead,
  LEAD_STATUSES,
  normalizeEmail,
} from "../_dashboard.js";

export const config = { maxDuration: 15 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function priceText(record) {
  const fromFlier = record?.flier?.priceText;
  if (fromFlier) return `$${fromFlier}`;
  const usd = record?.boatData?.asking_price_usd;
  if (usd == null || Number.isNaN(Number(usd))) return null;
  return "$" + Number(usd).toLocaleString("en-US");
}

function boatName(record) {
  if (!record) return null;
  const flier = record?.flier;
  if (flier?.boatName) return flier.boatName;
  const bd = record?.boatData;
  return [bd?.year, bd?.make, bd?.model].filter(Boolean).join(" ") || null;
}

function fallbackName(record) {
  const iso = record?.created_at;
  if (!iso) return "Untitled listing";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Untitled listing";
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Listing from ${date}`;
}

async function loginHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
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
}

async function logoutHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}

async function meHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const session = readSession(req);
  if (!session?.email) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  return res.status(200).json({ email: session.email });
}

async function listingsHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const session = await requireSession(req, res);
  if (!session) return;

  if (!getRedis()) {
    return res.status(500).json({ error: "Redis client unavailable on this deployment." });
  }
  await ensureBackfilled();

  const slugs = await getBrokerListingSlugs(session.email);
  const origin = getPublicOrigin(req);

  const records = await Promise.all(slugs.map((s) => loadListing(s)));
  const leadCounts = await countLeadsForListings(session.email, slugs);

  const listings = slugs
    .map((slug, i) => {
      const record = records[i];
      if (!record) return null;
      return {
        slug,
        boatName: boatName(record) || fallbackName(record),
        price: priceText(record),
        url: record.listingUrl || listingUrl(origin, slug),
        createdAt: record.created_at ?? null,
        updatedAt: record.updated_at ?? null,
        viewCount: record.view_count ?? 0,
        leadCount: leadCounts[slug] ?? 0,
      };
    })
    .filter(Boolean);

  return res.status(200).json({ email: session.email, listings });
}

async function listLeads(req, res, session) {
  if (!getRedis()) {
    return res.status(500).json({ error: "Redis client unavailable on this deployment." });
  }
  await ensureBackfilled();

  const slugFilter = req.query?.slug ? String(req.query.slug).trim() : null;
  const keys = await getBrokerLeadKeys(session.email);
  const filteredKeys = slugFilter
    ? keys.filter((k) => k.startsWith(`lead:${slugFilter}:`))
    : keys;

  const records = await loadLeadsBatch(filteredKeys);
  const slugs = new Set();
  for (const [key] of records) {
    const m = key.match(/^lead:([a-z0-9-]+):/);
    if (m) slugs.add(m[1]);
  }
  const listingBySlug = new Map();
  const origin = getPublicOrigin(req);
  await Promise.all(
    [...slugs].map(async (slug) => {
      const rec = await loadListing(slug);
      listingBySlug.set(slug, {
        boatName: boatName(rec),
        url: rec?.listingUrl || listingUrl(origin, slug),
      });
    }),
  );

  const leads = [];
  for (const [key, record] of records) {
    if (!record) continue;
    const m = key.match(/^lead:([a-z0-9-]+):/);
    const slug = m ? m[1] : null;
    const listing = slug ? listingBySlug.get(slug) : null;
    leads.push({
      key,
      slug,
      name: record.name ?? null,
      email: record.email ?? null,
      phone: record.phone ?? null,
      message: record.message ?? null,
      cash_buyer: !!record.cash_buyer,
      trade_in: !!record.trade_in,
      financing: !!record.financing,
      status: record.status || "New",
      notes: record.notes || "",
      created_at: record.created_at ?? null,
      status_updated_at: record.status_updated_at ?? null,
      listing: listing
        ? { boatName: listing.boatName, url: listing.url, slug }
        : { boatName: null, url: null, slug },
    });
  }

  leads.sort((a, b) => {
    const at = Date.parse(a.created_at ?? "") || 0;
    const bt = Date.parse(b.created_at ?? "") || 0;
    return bt - at;
  });

  return res.status(200).json({
    email: session.email,
    statuses: LEAD_STATUSES,
    leads,
  });
}

async function patchLead(req, res, session) {
  const body = req.body ?? {};
  const key = String(body.key ?? "").trim();
  if (!/^lead:[a-z0-9-]+:.+$/.test(key)) {
    return res.status(400).json({ error: "Invalid lead key." });
  }
  const slug = key.match(/^lead:([a-z0-9-]+):/)[1];
  const listing = await loadListing(slug);
  if (!listing) {
    return res.status(404).json({ error: "Listing not found." });
  }
  const brokerEmail = normalizeEmail(
    listing?.broker?.email || listing?.boatData?.broker?.email || "",
  );
  if (!brokerEmail || brokerEmail !== session.email) {
    console.warn("[dashboard.leads] auth mismatch", {
      sessionEmail: session.email,
      brokerEmail,
      key,
    });
    return res.status(403).json({ error: "Not your lead." });
  }

  const patch = {};
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.notes !== undefined) patch.notes = String(body.notes ?? "");
  if (patch.status === undefined && patch.notes === undefined) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  try {
    const updated = await updateLead(key, patch);
    return res.status(200).json({
      ok: true,
      status: updated.status,
      notes: updated.notes ?? "",
      status_updated_at: updated.status_updated_at ?? null,
    });
  } catch (err) {
    console.error("[dashboard.leads] update failed", err);
    return res.status(400).json({ error: err?.message ?? "Update failed" });
  }
}

async function leadsHandler(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  if (req.method === "GET") return await listLeads(req, res, session);
  if (req.method === "POST" || req.method === "PATCH") {
    return await patchLead(req, res, session);
  }
  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ error: "GET, POST, or PATCH only" });
}

async function deleteListingHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const session = await requireSession(req, res);
  if (!session) return;

  const redis = getRedis();
  if (!redis) {
    return res.status(500).json({ error: "Redis client unavailable on this deployment." });
  }

  const slug = String(req.body?.slug ?? "").trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Valid slug required." });
  }

  const record = await loadListing(slug);
  if (!record) {
    return res.status(404).json({ error: "Listing not found." });
  }

  const brokerEmail = normalizeEmail(
    record?.broker?.email || record?.boatData?.broker?.email || "",
  );
  if (!brokerEmail || brokerEmail !== session.email) {
    console.warn("[dashboard.delete-listing] auth mismatch", {
      sessionEmail: session.email,
      brokerEmail,
      slug,
    });
    return res.status(403).json({ error: "Not your listing." });
  }

  const allLeadKeys = await getBrokerLeadKeys(session.email);
  const leadKeys = allLeadKeys.filter((k) => k.startsWith(`lead:${slug}:`));
  const photoUrls = Array.isArray(record.photoUrls) ? record.photoUrls.filter(Boolean) : [];

  let deletedLeadCount = 0;
  for (const key of leadKeys) {
    try {
      await redis.del(key);
      deletedLeadCount++;
    } catch (err) {
      console.error("[dashboard.delete-listing] lead del failed", { key, err: err?.message });
    }
  }
  if (leadKeys.length) {
    try {
      await redis.zrem(`leads:by-broker:${session.email}`, ...leadKeys);
    } catch (err) {
      console.error("[dashboard.delete-listing] zrem leads index failed", {
        email: session.email,
        err: err?.message,
      });
    }
  }

  let deletedPhotoCount = 0;
  for (const url of photoUrls) {
    try {
      await del(url);
      deletedPhotoCount++;
    } catch (err) {
      console.warn("[dashboard.delete-listing] blob del failed, continuing", {
        url,
        err: err?.message,
      });
    }
  }

  try {
    await redis.del(`listing:${slug}`);
  } catch (err) {
    console.error("[dashboard.delete-listing] listing del failed", { slug, err: err?.message });
    return res.status(500).json({ error: "Failed to delete listing record." });
  }
  try {
    await redis.del(`listing:${slug}:views`);
  } catch (err) {
    console.warn("[dashboard.delete-listing] view counter del failed", {
      slug,
      err: err?.message,
    });
  }
  try {
    await redis.zrem(`listings:by-broker:${session.email}`, slug);
  } catch (err) {
    console.error("[dashboard.delete-listing] zrem listings index failed", {
      email: session.email,
      slug,
      err: err?.message,
    });
  }

  console.log("[dashboard.delete-listing] complete", {
    slug,
    email: session.email,
    deletedLeadCount,
    deletedPhotoCount,
  });
  return res.status(200).json({ success: true, deletedLeadCount, deletedPhotoCount });
}

const ACTIONS = {
  login: loginHandler,
  logout: logoutHandler,
  me: meHandler,
  listings: listingsHandler,
  leads: leadsHandler,
  "delete-listing": deleteListingHandler,
};

export default async function handler(req, res) {
  const action = String(req.query?.action ?? "").trim();
  const fn = ACTIONS[action];
  if (!fn) {
    return res.status(404).json({ error: `Unknown dashboard action: ${action}` });
  }
  try {
    return await fn(req, res);
  } catch (err) {
    console.error(`[dashboard.${action}] crash`, err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err?.message ?? "Internal error" });
    }
  }
}
