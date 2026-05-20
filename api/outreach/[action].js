import { client, MODELS } from "../../src/config.js";
import { getRedis } from "../_codes.js";
import {
  normalizeEmail,
  readSession,
  getBrokerListingSlugs,
} from "../_dashboard.js";
import { loadListing } from "../_listings.js";

export const config = { maxDuration: 60 };

const MONTHLY_CAP = 200;
const MAX_CONTACTS = 5000;
const MAX_GENERATE_PER_REQUEST = 25;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function requireSuiteSession(req, res) {
  const session = readSession(req);
  if (!session?.email) {
    res.status(401).json({ error: "Not authenticated." });
    return null;
  }
  if (session.tier !== "SUITE") {
    res.status(403).json({
      error: "Buyer Outreach requires the Suite plan.",
      upgrade: true,
    });
    return null;
  }
  return session;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function usageKey(email, month = currentMonthKey()) {
  return `outreach_usage:${normalizeEmail(email)}:${month}`;
}

function contactsKey(email) {
  return `contacts:${normalizeEmail(email)}`;
}

function draftKey(email, slug, contactEmail, ts) {
  return `outreach_draft:${normalizeEmail(email)}:${slug}:${normalizeEmail(contactEmail)}:${ts}`;
}

function draftsIndexKey(email, slug) {
  return `outreach_drafts:by-listing:${normalizeEmail(email)}:${slug}`;
}

function parseStored(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;
  const src = String(text ?? "").replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim().length > 0));
}

function contactsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const emailIdx = header.indexOf("email");
  if (nameIdx < 0 || emailIdx < 0) {
    throw new Error("CSV must include 'name' and 'email' columns.");
  }
  const prefsIdx = header.indexOf("boat_prefs");
  const notesIdx = header.indexOf("notes");

  const out = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = String(cells[nameIdx] ?? "").trim();
    const email = normalizeEmail(cells[emailIdx] ?? "");
    if (!name || !EMAIL_RE.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      name,
      email,
      boat_prefs: prefsIdx >= 0 ? String(cells[prefsIdx] ?? "").trim() : "",
      notes: notesIdx >= 0 ? String(cells[notesIdx] ?? "").trim() : "",
    });
    if (out.length >= MAX_CONTACTS) break;
  }
  return out;
}

async function readUsage(redis, email) {
  const key = usageKey(email);
  const v = await redis.get(key);
  return Number(v) || 0;
}

async function loadContacts(redis, email) {
  const value = await redis.get(contactsKey(email));
  const parsed = parseStored(value);
  return Array.isArray(parsed) ? parsed : [];
}

function buildEmailPrompt({ record, contact, brokerProfile }) {
  const bd = record?.boatData ?? {};
  const broker = brokerProfile || {};
  const listing = record?.listing ?? {};
  const longDesc = String(listing.long_description ?? "");
  const descSnippet = longDesc.length > 1200 ? longDesc.slice(0, 1200) + "…" : longDesc;
  const priceUsd = bd.asking_price_usd;
  const priceStr = priceUsd != null
    ? "$" + Number(priceUsd).toLocaleString("en-US")
    : "Price on request";
  const title = [bd.year, bd.make, bd.model].filter(Boolean).join(" ") || "this boat";

  const facts = [];
  if (bd.year) facts.push(`Year: ${bd.year}`);
  if (bd.make) facts.push(`Make: ${bd.make}`);
  if (bd.model) facts.push(`Model: ${bd.model}`);
  if (bd.length_loa_ft) facts.push(`LOA: ${bd.length_loa_ft}'`);
  if (bd.beam_ft) facts.push(`Beam: ${bd.beam_ft}'`);
  if (bd.hull_material) facts.push(`Hull: ${bd.hull_material}`);
  if (bd.engines?.make_model) facts.push(`Engines: ${bd.engines.make_model}`);
  if (bd.engines?.total_hours != null) facts.push(`Engine hours: ${bd.engines.total_hours}`);
  if (bd.water_history) facts.push(`Water history: ${String(bd.water_history).replace(/_/g, " ")}`);
  if (bd.electronics_notes) facts.push(`Electronics: ${bd.electronics_notes}`);
  if (bd.recent_upgrades_notes) facts.push(`Recent upgrades: ${bd.recent_upgrades_notes}`);
  if (bd.accommodations?.berths != null) facts.push(`Berths: ${bd.accommodations.berths}`);

  const brokerSignature = [
    broker.name || "",
    broker.company || "",
    broker.phone || "",
    broker.email || "",
  ].filter(Boolean).join(" · ");

  return {
    system: `You are a working yacht broker writing a personalized buyer outreach email. Voice: warm, conversational, broker-to-buyer. NOT corporate marketing copy. Match the broker's voice — direct, knowledgeable, friendly. You are reaching out because this specific listing fits this specific buyer's known preferences. Reference 2-3 concrete features that match their preferences naturally — do not list specs. Keep the body to 120-180 words. End with the broker's name and contact details. Return ONLY JSON in the exact shape {"subject": "...", "body": "..."} with no markdown fences and no commentary.`,
    user: `LISTING
${title} — ${priceStr}
${facts.join("\n")}
${record?.listingUrl ? `Listing URL: ${record.listingUrl}` : ""}

DESCRIPTION
${descSnippet || "(no long description on file)"}

CONTACT
Name: ${contact.name}
Email: ${contact.email}
Boat preferences: ${contact.boat_prefs || "(none recorded)"}
Broker notes about this buyer: ${contact.notes || "(none)"}

BROKER (the sender)
${brokerSignature || "(broker signature missing)"}

Write the subject + body now.`,
  };
}

function tryParseModelJson(text) {
  const s = String(text || "").trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : s;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) return null;
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    return null;
  }
}

async function generateOneEmail({ record, contact, brokerProfile }) {
  const { system, user } = buildEmailPrompt({ record, contact, brokerProfile });
  const response = await client.messages.create({
    model: MODELS.narrative,
    max_tokens: 800,
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: user }],
  });
  const text = response?.content?.[0]?.text ?? "";
  const parsed = tryParseModelJson(text);
  if (!parsed || typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
    throw new Error("Model returned malformed output");
  }
  return {
    subject: parsed.subject.trim().slice(0, 160),
    body: parsed.body.trim().slice(0, 4000),
  };
}

async function templateHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const csv =
    "name,email,boat_prefs,notes\n" +
    `"Jane Doe","jane@example.com","40-45ft cruising sailboat, blue water capable","Met at Annapolis show 2024. Sailing the Caribbean next winter."\n` +
    `"John Smith","john@example.com","Sportfish 35-40ft, twin diesels","Looking to upgrade from 31' Bertram."\n`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="compass-line-contacts-template.csv"`);
  return res.status(200).send(csv);
}

async function contactsHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const session = requireSuiteSession(req, res);
  if (!session) return;
  const redis = getRedis();
  if (!redis) return res.status(500).json({ error: "Redis unavailable" });
  const [contacts, used] = await Promise.all([
    loadContacts(redis, session.email),
    readUsage(redis, session.email),
  ]);
  return res.status(200).json({
    contacts,
    usage: { used, cap: MONTHLY_CAP, month: currentMonthKey() },
  });
}

async function uploadContactsHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const session = requireSuiteSession(req, res);
  if (!session) return;
  const redis = getRedis();
  if (!redis) return res.status(500).json({ error: "Redis unavailable" });

  const csvText = String(req.body?.csv ?? "");
  if (!csvText.trim()) {
    return res.status(400).json({ error: "Send CSV content as { csv: '...' }." });
  }

  let contacts;
  try {
    contacts = contactsFromCsv(csvText);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (contacts.length === 0) {
    return res.status(400).json({ error: "No valid rows. Each contact needs name + email." });
  }

  await redis.set(contactsKey(session.email), contacts);
  return res.status(200).json({ ok: true, count: contacts.length, contacts });
}

async function generateHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const session = requireSuiteSession(req, res);
  if (!session) return;
  const redis = getRedis();
  if (!redis) return res.status(500).json({ error: "Redis unavailable" });

  const slug = String(req.body?.listing_slug ?? "").trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Valid listing_slug required." });
  }
  const selected = Array.isArray(req.body?.selected_contact_emails)
    ? req.body.selected_contact_emails.map((e) => normalizeEmail(e)).filter(Boolean)
    : [];
  if (selected.length === 0) {
    return res.status(400).json({ error: "Select at least one contact." });
  }
  if (selected.length > MAX_GENERATE_PER_REQUEST) {
    return res.status(400).json({
      error: `Select up to ${MAX_GENERATE_PER_REQUEST} contacts per generation.`,
    });
  }

  const ownedSlugs = await getBrokerListingSlugs(session.email);
  if (!ownedSlugs.includes(slug)) {
    return res.status(403).json({ error: "Not your listing." });
  }

  const record = await loadListing(slug);
  if (!record) return res.status(404).json({ error: "Listing not found." });

  const contacts = await loadContacts(redis, session.email);
  const contactMap = new Map(contacts.map((c) => [c.email, c]));
  const targets = selected
    .map((e) => contactMap.get(e))
    .filter((c) => c && EMAIL_RE.test(c.email));
  if (targets.length === 0) {
    return res.status(400).json({ error: "None of the selected emails are in your contact list." });
  }

  const used = await readUsage(redis, session.email);
  if (used + targets.length > MONTHLY_CAP) {
    return res.status(429).json({
      error: "Monthly outreach cap reached.",
      usage: { used, cap: MONTHLY_CAP, month: currentMonthKey() },
      remaining: Math.max(0, MONTHLY_CAP - used),
    });
  }

  const brokerProfile = record.broker || record.boatData?.broker || { email: session.email };

  const results = await Promise.all(
    targets.map((contact) =>
      generateOneEmail({ record, contact, brokerProfile })
        .then((draft) => ({ ok: true, contact, draft }))
        .catch((err) => {
          console.error("[outreach.generate] one failed", {
            contact: contact.email,
            slug,
            err: err?.message,
          });
          return { ok: false, contact, error: err?.message || "generation failed" };
        }),
    ),
  );

  const successful = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  const now = Date.now();
  const indexKey = draftsIndexKey(session.email, slug);
  const drafts = [];
  for (const r of successful) {
    const ts = now + Math.floor(Math.random() * 1000);
    const key = draftKey(session.email, slug, r.contact.email, ts);
    const draft = {
      key,
      slug,
      contact: { name: r.contact.name, email: r.contact.email },
      subject: r.draft.subject,
      body: r.draft.body,
      status: "draft",
      created_at: new Date(ts).toISOString(),
    };
    await redis.set(key, draft);
    try {
      await redis.zadd(indexKey, { score: ts, member: key });
    } catch (err) {
      console.warn("[outreach.generate] zadd failed", { key, err: err?.message });
    }
    drafts.push(draft);
  }

  if (successful.length > 0) {
    await redis.incrby(usageKey(session.email), successful.length);
  }

  const usedAfter = await readUsage(redis, session.email);
  return res.status(200).json({
    drafts,
    failed: failed.map((r) => ({ email: r.contact.email, error: r.error })),
    usage: { used: usedAfter, cap: MONTHLY_CAP, month: currentMonthKey() },
  });
}

async function draftsListHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const session = requireSuiteSession(req, res);
  if (!session) return;
  const redis = getRedis();
  if (!redis) return res.status(500).json({ error: "Redis unavailable" });
  const slug = String(req.query?.slug ?? "").trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Valid slug required." });
  }
  let keys = [];
  try {
    keys = await redis.zrange(draftsIndexKey(session.email, slug), 0, -1, { rev: true });
  } catch {
    keys = [];
  }
  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(200).json({ drafts: [] });
  }
  const values = await redis.mget(...keys);
  const drafts = keys
    .map((k, i) => {
      const parsed = parseStored(values?.[i]);
      return parsed ? { ...parsed, key: k } : null;
    })
    .filter(Boolean);
  return res.status(200).json({ drafts });
}

function isOwnedKey(session, key) {
  return typeof key === "string" && key.startsWith(`outreach_draft:${normalizeEmail(session.email)}:`);
}

async function updateDraftHandler(req, res) {
  if (req.method !== "POST" && req.method !== "PATCH") {
    res.setHeader("Allow", "POST, PATCH");
    return res.status(405).json({ error: "POST or PATCH only" });
  }
  const session = requireSuiteSession(req, res);
  if (!session) return;
  const redis = getRedis();
  if (!redis) return res.status(500).json({ error: "Redis unavailable" });
  const key = String(req.body?.key ?? "");
  if (!isOwnedKey(session, key)) {
    return res.status(403).json({ error: "Not your draft." });
  }
  const existing = parseStored(await redis.get(key));
  if (!existing) return res.status(404).json({ error: "Draft not found." });
  const next = { ...existing };
  if (typeof req.body?.subject === "string") next.subject = req.body.subject.slice(0, 160);
  if (typeof req.body?.body === "string") next.body = req.body.body.slice(0, 4000);
  next.updated_at = new Date().toISOString();
  await redis.set(key, next);
  return res.status(200).json({ ok: true, draft: next });
}

async function markSentHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const session = requireSuiteSession(req, res);
  if (!session) return;
  const redis = getRedis();
  if (!redis) return res.status(500).json({ error: "Redis unavailable" });
  const key = String(req.body?.key ?? "");
  if (!isOwnedKey(session, key)) {
    return res.status(403).json({ error: "Not your draft." });
  }
  const existing = parseStored(await redis.get(key));
  if (!existing) return res.status(404).json({ error: "Draft not found." });
  const next = { ...existing, status: "sent", sent_at: new Date().toISOString() };
  await redis.set(key, next);
  return res.status(200).json({ ok: true, draft: next });
}

const ACTIONS = {
  template: templateHandler,
  contacts: contactsHandler,
  "upload-contacts": uploadContactsHandler,
  generate: generateHandler,
  drafts: draftsListHandler,
  "update-draft": updateDraftHandler,
  "mark-sent": markSentHandler,
};

export default async function handler(req, res) {
  const action = String(req.query?.action ?? "").trim();
  const fn = ACTIONS[action];
  if (!fn) {
    return res.status(404).json({ error: `Unknown action: ${action || "(none)"}` });
  }
  try {
    return await fn(req, res);
  } catch (err) {
    console.error("[outreach] handler crash", { action, err: err?.message, stack: err?.stack });
    if (!res.headersSent) {
      return res.status(500).json({ error: err?.message || "Internal error" });
    }
  }
}
