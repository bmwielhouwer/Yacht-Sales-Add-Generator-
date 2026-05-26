import { isCodeActive } from "./_codes.js";
import { readSession } from "./_dashboard.js";

const FOUNDER_MESSAGE = {
  status: "founder_message",
  title: "A note from Brian",
  message:
    "Hey, Brian here — founder of Compass Line Marine.\n\n" +
    "We're in final launch polish this week, so the AI generator is briefly offline while I lock down the last few details.\n\n" +
    "I don't want you walking away empty-handed though. Send me your boat notes and photos directly and I'll personally produce your full listing package — long-form description, social copy, email blast, downloadable flier — back to you within 24 hours.\n\n" +
    "Email: brianwielhouwer@gmail.com\n" +
    "Phone: (781) 635-3702\n\n" +
    "Thanks for your patience.\n\n" +
    "— Brian",
};

export function respondFounderMessage(res, err) {
  console.error("Anthropic call failed — returning founder message:", err?.stack ?? err);
  return res.status(200).json(FOUNDER_MESSAGE);
}

function envOverrides() {
  const raw = process.env.MARINE_ACCESS_CODES;
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
}

export async function isValidAccessCode(code) {
  if (typeof code !== "string") return false;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return false;

  const overrides = envOverrides();
  if (overrides?.has(normalized)) return true;

  try {
    return await isCodeActive(normalized);
  } catch (err) {
    console.error("Redis lookup failed:", err);
    return false;
  }
}

export function withGuard(handler, { requireCode = true } = {}) {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "POST only" });
    }
    const anthropicApiKey =
      req.headers["x-anthropic-key"] || process.env.ANTHROPIC_API_KEY || null;
    if (!anthropicApiKey) {
      return res.status(500).json({
        error:
          "No Anthropic API key found. Enter your API key in the settings panel, or set ANTHROPIC_API_KEY in Vercel environment variables.",
      });
    }
    req.anthropicApiKey = anthropicApiKey;
    if (requireCode) {
      const session = readSession(req);
      if (session?.email) {
        req.session = session;
      } else {
        const supplied = req.headers["x-access-code"];
        if (!(await isValidAccessCode(supplied))) {
          return res
            .status(403)
            .json({ error: "Access code required. Refresh the page and re-enter your code." });
        }
      }
    }
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message ?? String(err) });
      }
    }
  };
}
