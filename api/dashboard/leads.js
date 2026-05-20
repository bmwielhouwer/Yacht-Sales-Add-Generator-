import { getRedis } from "../_codes.js";
import { loadListing, listingUrl, getPublicOrigin } from "../_listings.js";
import {
  requireSession,
  ensureBackfilled,
  getBrokerLeadKeys,
  loadLeadsBatch,
  loadLead,
  updateLead,
  LEAD_STATUSES,
  normalizeEmail,
} from "../_dashboard.js";

export const config = { maxDuration: 15 };

function boatName(record) {
  if (!record) return null;
  if (record.flier?.boatName) return record.flier.boatName;
  const bd = record.boatData;
  return [bd?.year, bd?.make, bd?.model].filter(Boolean).join(" ") || null;
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

export default async function handler(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  try {
    if (req.method === "GET") return await listLeads(req, res, session);
    if (req.method === "POST" || req.method === "PATCH") return await patchLead(req, res, session);
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "GET, POST, or PATCH only" });
  } catch (err) {
    console.error("[dashboard.leads] crash", err);
    return res.status(500).json({ error: err?.message ?? "Internal error" });
  }
}
