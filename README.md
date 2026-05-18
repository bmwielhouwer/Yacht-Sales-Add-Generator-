# Yacht Sales Ad Generator

Compass Line Marine listing-package generator. Takes broker notes plus photos and produces:

- a long YachtWorld / Boat Trader description
- Facebook Marketplace blurb
- Facebook feed post
- Instagram caption + hashtags
- LinkedIn post
- email blast (subject + body)
- a recommended photo display order
- a list of missing photo categories the broker should still capture

Three model calls under the hood:

1. **Extract** boat data from free-form text — `claude-haiku-4-5-20251001`
2. **Analyze** photos — `claude-haiku-4-5-20251001`
3. **Generate** the full marketing package — `claude-sonnet-4-6`

All three calls use prompt caching (`cache_control: { type: "ephemeral" }`) so the static instructions only pay full price on the first call inside each 5-minute window.

## Setup

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

Full pipeline from raw broker notes + a directory of photos:

```bash
node src/cli.js \
  --input examples/raw_input.example.txt \
  --photos path/to/listing/photos
```

Skip the extraction step (you already have structured data):

```bash
node src/cli.js \
  --boat-data examples/boat_data.example.json \
  --photos path/to/listing/photos
```

Skip both LLM pre-steps (testing the narrative prompt in isolation):

```bash
node src/cli.js \
  --boat-data examples/boat_data.example.json \
  --photo-summary examples/photo_summary.example.json
```

The full listing package is written to stdout as JSON. Progress messages go to stderr, so this works:

```bash
node src/cli.js --input notes.txt --photos ./photos > listing.json
```

## Layout

```
prompts/
  narrative-system.txt     master listing-package prompt (Sonnet)
  extract-boat-data.txt    structured-data extractor (Haiku)
  analyze-photos.txt       vision categorizer (Haiku)
docs/
  narrative-v1.md          design notes for the master prompt
examples/
  raw_input.example.txt    sample broker intake notes
  boat_data.example.json   what extraction returns
  photo_summary.example.json  what photo analysis returns
src/
  cli.js                   command-line entry point
  generateListing.js       Sonnet narrative call
  extractBoatData.js       Haiku extraction call
  analyzePhotos.js         Haiku vision call
  loadPrompt.js            prompt loading + template filling
  config.js                Anthropic client + model IDs
```

## Iterating on the prompts

See `docs/narrative-v1.md` for the iteration plan. Short version: save 3–5 gold-standard outputs, regenerate against the same inputs whenever you tweak the prompt, and compare.
