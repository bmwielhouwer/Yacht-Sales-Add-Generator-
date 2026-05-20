import { analyzePhotos } from "../src/analyzePhotos.js";
import { withGuard } from "./_lib.js";
import { uploadAllPhotos } from "./_blob.js";

export const config = { maxDuration: 60 };

export default withGuard(async (req, res) => {
  const { photos = [] } = req.body ?? {};
  const [photoSummary, photoUrls] = await Promise.all([
    analyzePhotos(photos),
    uploadAllPhotos(photos),
  ]);
  return res.status(200).json({ photoSummary, photoUrls });
});
