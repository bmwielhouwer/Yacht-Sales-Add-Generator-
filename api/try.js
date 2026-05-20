import { checkAccessCode } from "./_lib.js";
import { recordLogin } from "./_codes.js";

export const config = { maxDuration: 10 };

function escapeJs(s) {
  return String(s).replace(/[\\"'`<>]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function renderSuccessHtml(code, tier) {
  const safeCode = escapeJs(code);
  const safeTier = tier ? escapeJs(tier) : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Unlocking…</title>
  <style>
    html, body { margin: 0; padding: 0; background: #F7F7F4; color: #1A1A1A; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; }
    .ring { width: 36px; height: 36px; border-radius: 50%; border: 3px solid #e6e3dc; border-top-color: #0B2545; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .msg { font-size: 14px; color: #5F5F5F; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="ring" aria-hidden="true"></div>
    <div class="msg">Unlocking your access…</div>
  </div>
  <script>
    try {
      localStorage.setItem("clm.access_code", "${safeCode}");
      ${safeTier ? `localStorage.setItem("clm.tier", "${safeTier}");` : `localStorage.removeItem("clm.tier");`}
    } catch (e) {}
    location.replace("/");
  </script>
  <noscript>
    <p style="text-align:center;margin-top:24px;">
      JavaScript is required to use the share link.
      <a href="/">Open the generator</a>.
    </p>
  </noscript>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const code = String(req.query?.code ?? "").trim();
  if (!code) {
    res.statusCode = 302;
    res.setHeader("Location", "/?gate_error=invalid");
    return res.end();
  }

  let result;
  try {
    result = await checkAccessCode(code);
  } catch (err) {
    console.error("[try] checkAccessCode crashed", err);
    result = { ok: false, reason: "not_found", record: null };
  }

  if (!result.ok) {
    const reason = result.reason || "invalid";
    res.statusCode = 302;
    res.setHeader("Location", `/?gate_error=${encodeURIComponent(reason)}`);
    return res.end();
  }

  if (result.record) {
    try {
      await recordLogin(code);
    } catch (err) {
      console.warn("[try] recordLogin failed", err?.message);
    }
  }

  const tier = result.record?.tier ? String(result.record.tier).toUpperCase() : null;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(renderSuccessHtml(code.toUpperCase(), tier));
}
