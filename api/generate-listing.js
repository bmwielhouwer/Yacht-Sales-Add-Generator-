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
        "ANTHROPIC_API_KEY is not set on this deployment. Add it in Vercel → Project Settings → Environment Variables and redeploy.",
    });
  }

  try {
    const {
      rawInput,
      category,
      askingPrice,
      broker,
      photos = [],
      boatData: presetBoatData,
      photoSummary: presetPhotoSummary,
    } = req.body ?? {};

    if (!presetBoatData && !rawInput?.trim()) {
      return res.status(400).json({ error: "Broker notes are required." });
    }

    const [extractedBoatData, photoSummary] = await Promise.all([
      presetBoatData ?? extractBoatData(rawInput),
      presetPhotoSummary ?? analyzePhotos(photos),
    ]);

    const boatData = { ...extractedBoatData };
    if (category?.trim()) boatData.category = category.trim();
    if (askingPrice != null && askingPrice !== "") {
      boatData.asking_price_usd = Number(askingPrice);
    }
    if (broker) {
      boatData.broker = {
        name: broker.name?.trim() || boatData.broker?.name || null,
        phone: broker.phone?.trim() || boatData.broker?.phone || null,
        email: broker.email?.trim() || boatData.broker?.email || null,
        company: broker.company?.trim() || boatData.broker?.company || null,
      };
    }

    const listing = await generateListing({ boatData, photoSummary });

    return res.status(200).json({ boatData, photoSummary, listing });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message ?? String(err) });
  }
}
