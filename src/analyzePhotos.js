import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { getClient, MODELS } from "./config.js";
import { loadPrompt, parseJsonResponse } from "./loadPrompt.js";

const SYSTEM = loadPrompt("analyze-photos");

const MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const STANDARD_CATEGORIES = [
  "exterior_starboard_wide",
  "bow",
  "stern",
  "helm",
  "salon",
  "galley",
  "berth_master",
  "head",
  "engine_room",
];

const MAX_HERO_CANDIDATES = 3;

function imageBlock(source) {
  if (typeof source !== "string") {
    throw new Error("Photo source must be a string (path, http(s) URL, or data URL)");
  }
  const dataUrlMatch = source.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      type: "image",
      source: { type: "base64", media_type: dataUrlMatch[1], data: dataUrlMatch[2] },
    };
  }
  if (/^https?:\/\//i.test(source)) {
    return { type: "image", source: { type: "url", url: source } };
  }
  const mediaType = MEDIA_TYPES[extname(source).toLowerCase()];
  if (!mediaType) {
    throw new Error(`Unsupported image type: ${source}`);
  }
  const data = readFileSync(source).toString("base64");
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data },
  };
}

async function classifyOne(source, index, { apiKey } = {}) {
  const content = [
    imageBlock(source),
    {
      type: "text",
      text:
        `Classify this single photo per the system instructions. ` +
        `Return JSON only, in this exact shape (no surrounding object, no markdown): ` +
        `{"category":"string","hero_candidate":boolean,"quality":"string","issue":"string or null"}. ` +
        `Set "issue" to a short broker-facing note when quality is not "good", otherwise null.`,
    },
  ];

  const response = await getClient(apiKey).messages.create({
    model: MODELS.vision,
    max_tokens: 400,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  const parsed = parseJsonResponse(response.content[0].text);
  return {
    index: index + 1,
    category: parsed.category ?? "other",
    hero_candidate: Boolean(parsed.hero_candidate),
    quality: parsed.quality ?? "good",
    _issue: parsed.issue ?? null,
  };
}

export async function analyzePhotos(photoSources, { apiKey } = {}) {
  if (!Array.isArray(photoSources) || photoSources.length === 0) {
    return { photos: [], missing_categories: [...STANDARD_CATEGORIES], quality_issues: [] };
  }

  const errors = [];
  const settled = await Promise.all(
    photoSources.map((source, i) =>
      classifyOne(source, i, { apiKey }).catch((err) => {
        console.error(`Photo ${i + 1} classification failed:`, err?.message ?? err);
        errors.push(err);
        return null;
      }),
    ),
  );

  if (errors.length === photoSources.length) {
    throw errors[0];
  }

  const photos = settled.filter(Boolean);

  let heroCount = 0;
  for (const p of photos) {
    if (p.hero_candidate && heroCount < MAX_HERO_CANDIDATES) {
      heroCount += 1;
    } else {
      p.hero_candidate = false;
    }
  }

  const presentCategories = new Set(photos.map((p) => p.category));
  const missing_categories = STANDARD_CATEGORIES.filter((c) => !presentCategories.has(c));

  const quality_issues = photos
    .filter((p) => p.quality && p.quality !== "good")
    .map((p) => p._issue || `Photo ${p.index} (${p.category}): ${p.quality}`);

  for (const p of photos) delete p._issue;

  return { photos, missing_categories, quality_issues };
}
