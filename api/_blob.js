import { put } from "@vercel/blob";
import { randomBytes } from "node:crypto";

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:([^;,]+)(?:;([^,]+))?,(.+)$/);
  if (!m) return null;
  const mime = m[1] || "image/jpeg";
  const isBase64 = m[2] === "base64";
  const body = m[3];
  const buf = isBase64
    ? Buffer.from(body, "base64")
    : Buffer.from(decodeURIComponent(body), "utf8");
  return { mime, buf };
}

function randomId(n = 10) {
  return randomBytes(n).toString("hex");
}

export async function uploadPhotoDataUrl(dataUrl, { folder = "listings" } = {}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  }
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("Expected a data: URL");
  const ext = EXT_BY_MIME[parsed.mime] ?? "jpg";
  const id = `${Date.now().toString(36)}-${randomId(6)}`;
  const path = `${folder}/${id}.${ext}`;
  const result = await put(path, parsed.buf, {
    access: "public",
    contentType: parsed.mime,
    addRandomSuffix: false,
  });
  return { url: result.url, path };
}

export async function uploadLogoDataUrl(dataUrl) {
  return uploadPhotoDataUrl(dataUrl, { folder: "logos" });
}

export async function uploadAllPhotos(dataUrls) {
  if (!Array.isArray(dataUrls) || dataUrls.length === 0) return [];
  const results = await Promise.all(
    dataUrls.map((d) =>
      uploadPhotoDataUrl(d).catch((err) => {
        console.error("Blob upload failed:", err);
        return null;
      }),
    ),
  );
  return results.map((r) => r?.url ?? null);
}
