import { generateListing } from "../src/generateListing.js";
import { withGuard, respondFounderMessage } from "./_lib.js";

export const config = { maxDuration: 60 };

export default withGuard(async (req, res) => {
  const { boatData, photoSummary, listingUrl } = req.body ?? {};
  if (!boatData) return res.status(400).json({ error: "boatData is required." });
  if (!photoSummary) return res.status(400).json({ error: "photoSummary is required." });

  let listing;
  try {
    listing = await generateListing({ boatData, photoSummary, listingUrl });
  } catch (err) {
    return respondFounderMessage(res, err);
  }
  return res.status(200).json({ listing });
});
