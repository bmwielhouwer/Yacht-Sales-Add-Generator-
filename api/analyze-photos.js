import { analyzePhotos } from "../src/analyzePhotos.js";
import { withGuard, respondFounderMessage } from "./_lib.js";
import { uploadAllPhotos } from "./_blob.js";

export const config = { maxDuration: 60 };

export default withGuard(async (req, res) => {
  const { photos = [] } = req.body ?? {};

  const uploadPromise = uploadAllPhotos(photos);
  uploadPromise.catch((err) => console.error("uploadAllPhotos failed:", err));

  let photoSummary;
  try {
    photoSummary = await analyzePhotos(photos);
  } catch (err) {
    return respondFounderMessage(res, err);
  }
  const photoUrls = await uploadPromise;

  return res.status(200).json({ photoSummary, photoUrls });
});
