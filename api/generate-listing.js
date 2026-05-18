import { extractBoatData } from "../src/extractBoatData.js";
import { analyzePhotos } from "../src/analyzePhotos.js";
import { generateListing } from "../src/generateListing.js";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not set on this deployment. Add it in Vercel → Project → Settings → Environment Variables and redeploy.",
    });
  }

  try {
    const {
      rawInput,
      photoUrls = [],
      boatData: presetBoatData,
      photoSummary: presetPhotoSummary,
    } = req.body ?? {};

    if (!presetBoatData && !rawInput) {
      return res.status(400).json({
        error: "Provide rawInput (broker notes) or boatData (structured JSON).",
      });
    }

    const cleanUrls = photoUrls
      .map((u) => (typeof u === "string" ? u.trim() : ""))
      .filter(Boolean);

    const boatData = presetBoatData ?? (await extractBoatData(rawInput));
    const photoSummary = presetPhotoSummary ?? (await analyzePhotos(cleanUrls));
    const listing = await generateListing({ boatData, photoSummary });

    return res.status(200).json({ boatData, photoSummary, listing });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message ?? String(err) });
  }
}
