import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { client, MODELS } from "./config.js";
import { loadPrompt, parseJsonResponse } from "./loadPrompt.js";

const SYSTEM = loadPrompt("analyze-photos");

const MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function imageBlock(source) {
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

export async function analyzePhotos(photoSources) {
  if (photoSources.length === 0) {
    return { photos: [], missing_categories: [], quality_issues: [] };
  }

  const content = [
    ...photoSources.map(imageBlock),
    {
      type: "text",
      text: `Classify these ${photoSources.length} photos per the system instructions. They are 1-indexed in the order shown.`,
    },
  ];

  const response = await client.messages.create({
    model: MODELS.vision,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  return parseJsonResponse(response.content[0].text);
}
