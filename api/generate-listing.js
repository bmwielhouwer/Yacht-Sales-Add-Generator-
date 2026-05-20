import { generateListing } from "../src/generateListing.js";
import { withGuard } from "./_lib.js";

export const config = { maxDuration: 45 };

export default withGuard(async (req, res) => {
  const { boatData, photoSummary, listingUrl } = req.body ?? {};
  if (!boatData) return res.status(400).json({ error: "boatData is required." });
  if (!photoSummary) return res.status(400).json({ error: "photoSummary is required." });

  const listing = await generateListing({ boatData, photoSummary, listingUrl });
  return res.status(200).json({ listing });
});
