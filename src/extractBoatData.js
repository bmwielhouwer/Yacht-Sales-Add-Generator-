import { client, MODELS } from "./config.js";
import { fillTemplate, loadPrompt, parseJsonResponse } from "./loadPrompt.js";

const SYSTEM = loadPrompt("extract-boat-data");

export async function extractBoatData(rawInput) {
  const system = fillTemplate(SYSTEM, { RAW_INPUT: rawInput });

  const response = await client.messages.create({
    model: MODELS.extract,
    max_tokens: 2000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: "Extract the boat data per the schema in the system instructions.",
      },
    ],
  });

  return parseJsonResponse(response.content[0].text);
}
