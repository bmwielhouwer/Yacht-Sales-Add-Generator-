import { loadListing, bumpViewCount } from "../_listings.js";

export const config = { maxDuration: 10 };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function escAttr(s) {
  return esc(s);
}

function nl2p(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function formatPrice(usd) {
  if (usd == null || Number.isNaN(Number(usd))) return null;
  return "$" + Number(usd).toLocaleString("en-US");
}

function specsRows(bd) {
  if (!bd) return "";
  const rows = [];
  const add = (label, val) => {
    if (val == null || val === "") return;
    rows.push(`<tr><th>${esc(label)}</th><td>${esc(val)}</td></tr>`);
  };
  add("Year", bd.year);
  add("Make", bd.make);
  add("Model", bd.model);
  add("Category", bd.category);
  if (bd.length_loa_ft != null) add("LOA", `${bd.length_loa_ft}'`);
  if (bd.beam_ft != null) add("Beam", `${bd.beam_ft}'`);
  if (bd.draft_ft != null) add("Draft", `${bd.draft_ft}'`);
  if (bd.engines) {
    if (bd.engines.count != null) add("Engines", bd.engines.count);
    if (bd.engines.make_model) add("Engine make/model", bd.engines.make_model);
    if (bd.engines.total_hours != null) add("Total hours", bd.engines.total_hours);
    if (bd.engines.fuel_type) add("Fuel", bd.engines.fuel_type);
  }
  if (bd.water_history) add("Water history", String(bd.water_history).replace(/_/g, " "));
  if (bd.hull_material) add("Hull material", bd.hull_material);
  if (bd.accommodations?.berths != null) add("Berths", bd.accommodations.berths);
  if (bd.electronics_notes) add("Electronics", bd.electronics_notes);
  if (bd.recent_upgrades_notes) add("Recent upgrades", bd.recent_upgrades_notes);
  if (bd.trailer_included != null) add("Trailer", bd.trailer_included ? "Included" : "Not included");
  if (bd.warranty_remaining) add("Warranty", bd.warranty_remaining);
  return rows.join("");
}

function orderedPhotoUrls(record) {
  const urls = Array.isArray(record.photoUrls) ? record.photoUrls : [];
  const order = Array.isArray(record.photoOrder) && record.photoOrder.length
    ? record.photoOrder
    : urls.map((_, i) => i + 1);
  const seen = new Set();
  const out = [];
  for (const idx of order) {
    if (Number.isInteger(idx) && idx >= 1 && idx <= urls.length && !seen.has(idx)) {
      seen.add(idx);
      if (urls[idx - 1]) out.push(urls[idx - 1]);
    }
  }
  for (let i = 1; i <= urls.length; i++) {
    if (!seen.has(i) && urls[i - 1]) out.push(urls[i - 1]);
  }
  return out;
}

function renderPage(record, slug) {
  const bd = record.boatData ?? {};
  const broker = record.broker ?? bd.broker ?? {};
  const flier = record.flier ?? {};
  const listing = record.listing ?? {};

  const year = bd.year;
  const make = flier.boatNameYear || bd.make;
  const title = flier.boatName ||
    [bd.year, bd.make, bd.model].filter(Boolean).join(" ") ||
    "Boat listing";
  const price = flier.priceText
    ? "$" + flier.priceText
    : formatPrice(bd.asking_price_usd);
  const photoUrls = orderedPhotoUrls(record);
  const hero = photoUrls[0] || "";
  const longDesc = listing.long_description ?? "";
  const description = String(longDesc).split("\n").find((l) => l.trim().length > 40)?.slice(0, 160)
    ?? `${title}${price ? ` — ${price}` : ""}`;

  const specs = specsRows(bd);
  const phoneHref = broker.phone ? `tel:${String(broker.phone).replace(/[^+0-9]/g, "")}` : null;
  const tagline = flier.tagline || broker.tagline || "";

  const photoSlides = photoUrls
    .map(
      (u, i) =>
        `<div class="slide"><img src="${escAttr(u)}" alt="${escAttr(title)} photo ${i + 1}" loading="${i === 0 ? "eager" : "lazy"}" /></div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — Compass Line Marine</title>
<meta name="description" content="${escAttr(description)}" />
<meta property="og:title" content="${escAttr(title)}" />
<meta property="og:description" content="${escAttr(description)}" />
${hero ? `<meta property="og:image" content="${escAttr(hero)}" />` : ""}
<meta property="og:type" content="website" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/listing.css" />
</head>
<body>
<header class="lp-header">
  <div class="lp-header-inner">
    <span class="lp-brand">Compass Line Marine</span>
  </div>
</header>

<main class="lp-main">
  <section class="lp-carousel" aria-label="Boat photos">
    <div class="lp-track" id="lp-track">${photoSlides || '<div class="slide slide-empty">No photos yet</div>'}</div>
    ${photoUrls.length > 1 ? `<button class="lp-arrow lp-arrow-prev" aria-label="Previous photo" type="button">‹</button><button class="lp-arrow lp-arrow-next" aria-label="Next photo" type="button">›</button>` : ""}
  </section>

  <section class="lp-summary">
    <h1 class="lp-title">${esc(title)}</h1>
    ${price ? `<div class="lp-price">${esc(price)}</div>` : `<div class="lp-price lp-price-tbd">Price on request</div>`}
    <button class="lp-cta" type="button" id="lp-inquire">Request more info</button>
  </section>

  ${longDesc ? `<section class="lp-section"><h2>About this boat</h2><div class="lp-prose">${nl2p(longDesc)}</div></section>` : ""}

  ${specs ? `<section class="lp-section"><h2>Specifications</h2><table class="lp-specs">${specs}</table></section>` : ""}

  <section class="lp-section lp-broker">
    <h2>Listed by</h2>
    <div class="lp-broker-card">
      ${broker.name ? `<div class="lp-broker-name">${esc(broker.name)}</div>` : ""}
      ${broker.company || tagline ? `<div class="lp-broker-company">${esc(broker.company || tagline)}</div>` : ""}
      <div class="lp-broker-contact">
        ${phoneHref ? `<a href="${escAttr(phoneHref)}">${esc(broker.phone)}</a>` : ""}
        ${broker.email ? `<a href="mailto:${escAttr(broker.email)}">${esc(broker.email)}</a>` : ""}
      </div>
    </div>
  </section>
</main>

<button class="lp-cta lp-cta-sticky" type="button" id="lp-inquire-sticky">Request more info</button>

<div class="lp-modal" id="lp-modal" role="dialog" aria-modal="true" aria-labelledby="lp-modal-title" hidden>
  <div class="lp-modal-backdrop" data-close></div>
  <div class="lp-modal-card">
    <button class="lp-modal-close" aria-label="Close" type="button" data-close>×</button>
    <h2 id="lp-modal-title">Request more info</h2>
    <p class="lp-modal-sub">${esc(broker.name || "The broker")} will reach out within a few hours.</p>
    <form id="lp-inquiry-form" novalidate>
      <label class="lp-field">
        <span>Name <em>*</em></span>
        <input name="name" type="text" autocomplete="name" required />
      </label>
      <label class="lp-field">
        <span>Email <em>*</em></span>
        <input name="email" type="email" autocomplete="email" required />
      </label>
      <label class="lp-field">
        <span>Phone</span>
        <input name="phone" type="tel" autocomplete="tel" />
      </label>
      <label class="lp-field">
        <span>Message</span>
        <textarea name="message" rows="4" placeholder="When would you like to see the boat? Any questions?"></textarea>
      </label>
      <div class="lp-checks">
        <label><input type="checkbox" name="cash_buyer" /> I'm a cash buyer</label>
        <label><input type="checkbox" name="trade_in" /> I have a trade-in</label>
        <label><input type="checkbox" name="financing" /> I need financing</label>
      </div>
      <div class="lp-modal-error" id="lp-modal-error" hidden></div>
      <button type="submit" class="lp-submit" id="lp-submit">Send inquiry</button>
    </form>
    <div class="lp-modal-success" id="lp-modal-success" hidden></div>
  </div>
</div>

<footer class="lp-footer">
  Compass Line Marine · Built for serious yacht brokers
</footer>

<script>
(function() {
  const SLUG = ${JSON.stringify(slug)};
  const track = document.getElementById("lp-track");
  const prev = document.querySelector(".lp-arrow-prev");
  const next = document.querySelector(".lp-arrow-next");
  function scrollByOne(dir) {
    if (!track) return;
    const slide = track.querySelector(".slide");
    const w = slide ? slide.getBoundingClientRect().width : 400;
    track.scrollBy({ left: dir * w, behavior: "smooth" });
  }
  if (prev) prev.addEventListener("click", () => scrollByOne(-1));
  if (next) next.addEventListener("click", () => scrollByOne(1));

  const modal = document.getElementById("lp-modal");
  const form = document.getElementById("lp-inquiry-form");
  const submitBtn = document.getElementById("lp-submit");
  const errEl = document.getElementById("lp-modal-error");
  const okEl = document.getElementById("lp-modal-success");
  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => form?.querySelector("input[name=name]")?.focus(), 50);
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }
  document.getElementById("lp-inquire")?.addEventListener("click", openModal);
  document.getElementById("lp-inquire-sticky")?.addEventListener("click", openModal);
  modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    errEl.textContent = "";
    const fd = new FormData(form);
    const payload = {
      slug: SLUG,
      name: fd.get("name") || "",
      email: fd.get("email") || "",
      phone: fd.get("phone") || "",
      message: fd.get("message") || "",
      cash_buyer: fd.get("cash_buyer") === "on",
      trade_in: fd.get("trade_in") === "on",
      financing: fd.get("financing") === "on",
    };
    if (!payload.name.trim()) { errEl.textContent = "Please enter your name."; errEl.hidden = false; return; }
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(String(payload.email).trim())) {
      errEl.textContent = "Please enter a valid email."; errEl.hidden = false; return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    try {
      const r = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
      form.hidden = true;
      okEl.hidden = false;
      okEl.textContent = data.message || "Thanks! The broker will reach out soon.";
    } catch (err) {
      errEl.textContent = err.message || "Couldn't send — please try again.";
      errEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send inquiry";
    }
  });
})();
</script>
</body>
</html>`;
}

export default async function handler(req, res) {
  const slug = String(req.query.slug ?? "").trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send("<!doctype html><meta charset=utf-8><title>Not found</title><p>Listing not found.</p>");
  }
  const record = await loadListing(slug);
  if (!record) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send("<!doctype html><meta charset=utf-8><title>Not found</title><p>Listing not found.</p>");
  }

  bumpViewCount(slug).catch(() => {});

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).send(renderPage(record, slug));
}
