import { isValidAccessCode } from "./_lib.js";
import { loadListing, saveListing } from "./_listings.js";

export const config = { maxDuration: 10 };

const MAX_BODY_BYTES = 500_000;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "PUT") {
      res.setHeader("Allow", "POST, PUT");
      return res.status(405).json({ error: "POST or PUT only" });
    }
    const supplied = req.headers["x-access-code"];
    if (!(await isValidAccessCode(supplied))) {
      return res.status(403).json({ error: "Access code required." });
    }

    const body = req.body ?? {};
    const slug = String(body.slug ?? "").trim();
    console.log("[save-listing] incoming", {
      method: req.method,
      slug,
      hasListing: !!body.listing,
      photoUrlsCount: Array.isArray(body.photoUrls) ? body.photoUrls.length : 0,
    });
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      console.warn("[save-listing] invalid slug rejected:", JSON.stringify(slug));
      return res.status(400).json({ error: "Valid slug required." });
    }

    if (body.listing && JSON.stringify(body.listing).length > MAX_BODY_BYTES) {
      return res.status(413).json({ error: "Listing payload too large." });
    }

    const existing = await loadListing(slug);
    const now = new Date().toISOString();

    const record = {
      slug,
      listing: body.listing ?? existing?.listing ?? null,
      flier: body.flier ?? existing?.flier ?? null,
      boatData: body.boatData ?? existing?.boatData ?? null,
      photoUrls: Array.isArray(body.photoUrls)
        ? body.photoUrls
        : existing?.photoUrls ?? [],
      photoSummary: body.photoSummary ?? existing?.photoSummary ?? null,
      photoOrder: Array.isArray(body.photoOrder)
        ? body.photoOrder
        : existing?.photoOrder ?? [],
      broker: body.broker ?? existing?.broker ?? null,
      listingUrl: body.listingUrl ?? existing?.listingUrl ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      view_count: existing?.view_count ?? 0,
    };

    await saveListing(slug, record);
    return res.status(200).json({ ok: true, slug });
  } catch (err) {
    console.error("[save-listing] crash", {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      cause: err?.cause,
    });
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ error: err?.message ? `save-listing: ${err.message}` : "Internal error" });
    }
  }
}
