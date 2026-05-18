# Compass Line Marine — Master Narrative Prompt (v1)

This is the prompt that turns extracted boat data + photo analysis into the full Listing Package (long description, social posts, email blast, photo ordering). Use it as the system prompt in your Anthropic API call. Wrap it with `cache_control: { type: "ephemeral" }` from day one so you only pay full price the first time it's used in a 5-minute window.

Recommended model: `claude-sonnet-4-6` (quality matters for narrative work).

## 1. The system prompt

The full text lives in `prompts/narrative-system.txt`. It expects two template placeholders to be filled before sending:

- `{{BOAT_DATA_JSON}}` — the extracted boat data, stringified
- `{{PHOTO_SUMMARY_JSON}}` — the photo analysis, stringified

## 2. The user message

Static across every call so the cache stays warm:

```
Generate the Listing Package for this boat using the system instructions above. The boat data and photo summary are already included in the system context.
```

## 3. Expected `boat_data` shape

See `examples/boat_data.example.json`. Any missing fields should be `null` rather than absent — that way Claude knows the data was actually unavailable, not just dropped.

## 4. Expected `photo_summary` shape

See `examples/photo_summary.example.json`. The `missing_categories` field powers the "photo gap analysis" feature in the results UI.

## 5. API call shape

See `src/generateListing.js`. The system prompt is templated per-call and marked `cache_control: { type: "ephemeral" }`. Once volume justifies it, switch to the alternative pattern: keep the system prompt fully static and move `boat_data` / `photo_summary` into the user message.

## 6. How to iterate

The v1 prompt is solid but not optimal. Plan to refine it once you've generated 20–30 real listings. Watch for:

- Repeated phrasing across outputs — same hook line showing up in 5 listings means you need to give Claude more variety guidance.
- Wrong tone on a price segment — if $50K boats are reading too formal or $300K boats too casual, tune the price-point rules.
- Banned phrases sneaking through — add them to the avoid list.
- Wrong vocabulary for sailboats vs power — if sail listings sound generic, add a dedicated `<sailboat_vocabulary>` section.
- Hashtag staleness — refresh the example list every few months.

Save 3–5 of your best generated outputs as a "gold standard" file. When you tweak the prompt, regenerate against the same inputs and compare against the gold standard to make sure you haven't regressed.

## 7. Section regeneration

When the customer hits "Rewrite this section" on a single output, use a tiny prompt instead of re-running the full thing:

```
You previously generated this Instagram caption for [Year Make Model]:

[original caption]

Rewrite it with a fresh angle — different hook, different rhythm — while staying inside the same voice and length constraints. Return only the new caption text, no JSON, no commentary.
```

These section calls run in under a second and cost fractions of a cent each. Apply the same pattern for facebook_post, email_blast.subject, etc.
