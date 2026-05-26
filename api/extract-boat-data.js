import { extractBoatData } from "../src/extractBoatData.js";
import { withGuard, respondFounderMessage } from "./_lib.js";
import { reserveSlug, getPublicOrigin, listingUrl } from "./_listings.js";

export const config = { maxDuration: 30 };

export default withGuard(async (req, res) => {
  const { rawInput, category, askingPrice, broker } = req.body ?? {};
  if (!rawInput?.trim()) {
    return res.status(400).json({ error: "Broker notes are required." });
  }

  let boatData;
  try {
    boatData = await extractBoatData(rawInput, { apiKey: req.anthropicApiKey });
  } catch (err) {
    return respondFounderMessage(res, err);
  }

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

  const slug = await reserveSlug(boatData);
  const origin = getPublicOrigin(req);
  const url = listingUrl(origin, slug);

  return res.status(200).json({ boatData, slug, listingUrl: url });
});
