import { analyzePhotos } from "../src/analyzePhotos.js";
import { withGuard } from "./_lib.js";

export const config = { maxDuration: 45 };

export default withGuard(async (req, res) => {
  const { photos = [] } = req.body ?? {};
  const photoSummary = await analyzePhotos(photos);
  return res.status(200).json({ photoSummary });
});
