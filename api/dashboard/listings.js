import { getRedis } from "../_codes.js";
import { loadListing, listingUrl, getPublicOrigin } from "../_listings.js";
import {
  requireSession,
  ensureBackfilled,
  getBrokerListingSlugs,
  countLeadsForListings,
} from "../_dashboard.js";

export const config = { maxDuration: 15 };

function priceText(record) {
  const fromFlier = record?.flier?.priceText;
  if (fromFlier) return `$${fromFlier}`;
  const usd = record?.boatData?.asking_price_usd;
  if (usd == null || Number.isNaN(Number(usd))) return null;
  return "$" + Number(usd).toLocaleString("en-US");
}

function boatName(record) {
  const flier = record?.flier;
  if (flier?.boatName) return flier.boatName;
  const bd = record?.boatData;
  return [bd?.year, bd?.make, bd?.model].filter(Boolean).join(" ") || "Untitled listing";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const session = await requireSession(req, res);
  if (!session) return;

  try {
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
          boatName: boatName(record),
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
  } catch (err) {
    console.error("[dashboard.listings] crash", err);
    return res.status(500).json({ error: err?.message ?? "Internal error" });
  }
}
