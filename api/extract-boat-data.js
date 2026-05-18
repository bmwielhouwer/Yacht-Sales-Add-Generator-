import { extractBoatData } from "../src/extractBoatData.js";
import { withGuard } from "./_lib.js";

export const config = { maxDuration: 30 };

export default withGuard(async (req, res) => {
  const { rawInput, category, askingPrice, broker } = req.body ?? {};
  if (!rawInput?.trim()) {
    return res.status(400).json({ error: "Broker notes are required." });
  }

  const boatData = await extractBoatData(rawInput);

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

  return res.status(200).json({ boatData });
});
