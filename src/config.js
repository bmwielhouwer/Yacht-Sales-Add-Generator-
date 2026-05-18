import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  narrative: "claude-sonnet-4-6",
  extract: "claude-haiku-4-5-20251001",
  vision: "claude-haiku-4-5-20251001",
};

export const client = new Anthropic();
