#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { extractBoatData } from "./extractBoatData.js";
import { analyzePhotos } from "./analyzePhotos.js";
import { generateListing } from "./generateListing.js";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function collectPhotos(photosArg) {
  if (!photosArg) return [];
  const abs = resolve(photosArg);
  if (!existsSync(abs)) {
    throw new Error(`--photos path not found: ${abs}`);
  }
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs)
      .filter((name) => IMAGE_EXTS.has(extname(name).toLowerCase()))
      .sort()
      .map((name) => join(abs, name));
  }
  return [abs];
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string", short: "i" },
      "boat-data": { type: "string" },
      "photo-summary": { type: "string" },
      photos: { type: "string", short: "p" },
    },
  });

  let boatData;
  if (values["boat-data"]) {
    boatData = JSON.parse(readFileSync(resolve(values["boat-data"]), "utf8"));
    console.error("loaded boat_data from", values["boat-data"]);
  } else if (values.input) {
    const rawInput = readFileSync(resolve(values.input), "utf8");
    console.error("extracting boat_data from", values.input, "...");
    boatData = await extractBoatData(rawInput);
  } else {
    throw new Error("Provide --input <text-file> or --boat-data <json-file>");
  }

  let photoSummary;
  if (values["photo-summary"]) {
    photoSummary = JSON.parse(readFileSync(resolve(values["photo-summary"]), "utf8"));
    console.error("loaded photo_summary from", values["photo-summary"]);
  } else {
    const photoPaths = collectPhotos(values.photos);
    if (photoPaths.length > 0) {
      console.error(`analyzing ${photoPaths.length} photos...`);
    } else {
      console.error("no photos provided — generating with empty photo summary");
    }
    photoSummary = await analyzePhotos(photoPaths);
  }

  console.error("generating listing package...");
  const listing = await generateListing({ boatData, photoSummary });

  process.stdout.write(JSON.stringify(listing, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
