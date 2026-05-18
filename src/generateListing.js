import { client, MODELS } from "./config.js";
import { fillTemplate, loadPrompt, parseJsonResponse } from "./loadPrompt.js";

const SYSTEM = loadPrompt("narrative-system");

const USER_MESSAGE =
  "Generate the Listing Package for this boat using the system instructions above. The boat data and photo summary are already included in the system context.";

export async function generateListing({ boatData, photoSummary }) {
  const system = fillTemplate(SYSTEM, {
    BOAT_DATA_JSON: JSON.stringify(boatData, null, 2),
    PHOTO_SUMMARY_JSON: JSON.stringify(photoSummary, null, 2),
  });

  const response = await client.messages.create({
    model: MODELS.narrative,
    max_tokens: 4000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: USER_MESSAGE }],
  });

  return parseJsonResponse(response.content[0].text);
}
