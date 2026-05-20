const SHARE_BASE = "https://marine.compass-line-ventures.com/try";

const qrcodeReady = import("https://esm.sh/qrcode@1.5.4").then((m) => m.default ?? m);

const app = document.getElementById("ad-app");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function shareUrl(code) {
  return `${SHARE_BASE}?code=${encodeURIComponent(code)}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data ?? {};
}

function renderTemplate(id) {
  const tpl = document.getElementById(id);
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
}

function showToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied");
  } catch {
    showToast("Copy failed");
  }
}

function renderLogin() {
  renderTemplate("tpl-login");
  const form = document.getElementById("login-form");
  const errEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const password = form.elements.password.value;
    if (!password) {
      errEl.textContent = "Enter the admin password.";
      return;
    }
    submitBtn.disabled = true;
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      await mount();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

let allCodes = [];
let activeFilter = "all";
let searchTerm = "";

function statusOf(code) {
  if (code.status === "revoked") return "revoked";
  if (code.status === "expired") return "expired";
  if (code.expires_at && Date.parse(code.expires_at) < Date.now()) return "expired";
  return "active";
}

function renderCodesTable() {
  const wrap = document.getElementById("codes-table-wrap");
  if (!wrap) return;

  const term = searchTerm.trim().toLowerCase();
  const filtered = allCodes.filter((c) => {
    const status = statusOf(c);
    if (activeFilter !== "all" && status !== activeFilter) return false;
    if (!term) return true;
    const hay = [c.code, c.shop_name, c.broker_name, c.broker_email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(term);
  });

  if (!filtered.length) {
    wrap.innerHTML = `<div class="ad-empty">No codes match the current filter.</div>`;
    return;
  }

  const rows = filtered
    .map((c) => {
      const status = statusOf(c);
      return `<tr data-code="${escapeHtml(c.code)}">
        <td><code>${escapeHtml(c.code)}</code></td>
        <td>${escapeHtml(c.shop_name || "—")}${c.broker_name ? `<br><small style="color:var(--muted)">${escapeHtml(c.broker_name)}</small>` : ""}</td>
        <td>${escapeHtml(c.tier || "—")}</td>
        <td><span class="ad-status ad-status-${status}">${status}</span></td>
        <td>${escapeHtml(fmtDate(c.created_at))}</td>
        <td>${c.expires_at ? escapeHtml(fmtDate(c.expires_at)) : "—"}</td>
        <td>${escapeHtml(fmtDateTime(c.last_used_at))}</td>
        <td>${Number(c.login_count || 0)}</td>
        <td>
          <div class="ad-row-actions">
            <button type="button" data-action="copy" data-code="${escapeHtml(c.code)}">Copy URL</button>
            <button type="button" data-action="extend" data-code="${escapeHtml(c.code)}">Extend</button>
            <button type="button" class="danger" data-action="revoke" data-code="${escapeHtml(c.code)}" ${status === "revoked" ? "disabled" : ""}>Revoke</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  wrap.innerHTML = `
    <div class="ad-table-wrap">
      <table class="ad-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Shop</th>
            <th>Tier</th>
            <th>Status</th>
            <th>Created</th>
            <th>Expires</th>
            <th>Last used</th>
            <th>Logins</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function loadCodes() {
  const wrap = document.getElementById("codes-table-wrap");
  if (wrap) wrap.innerHTML = `<div class="ad-loading">Loading codes…</div>`;
  try {
    const data = await api("/api/admin/list-codes");
    allCodes = Array.isArray(data.codes) ? data.codes : [];
    renderCodesTable();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="ad-empty">Failed to load codes: ${escapeHtml(err.message)}</div>`;
  }
}

let extendTargetCode = null;
let revokeTargetCode = null;

function openExtendModal(code) {
  extendTargetCode = code;
  const modal = document.getElementById("extend-modal");
  document.getElementById("extend-code-label").textContent = code;
  const dateEl = document.getElementById("extend-date");
  const existing = allCodes.find((c) => c.code === code);
  if (existing?.expires_at) {
    const d = new Date(existing.expires_at);
    if (!Number.isNaN(d.getTime())) {
      dateEl.value = d.toISOString().slice(0, 10);
    } else {
      dateEl.value = "";
    }
  } else {
    dateEl.value = "";
  }
  document.getElementById("extend-error").textContent = "";
  modal.hidden = false;
}

function openRevokeModal(code) {
  revokeTargetCode = code;
  document.getElementById("revoke-code-label").textContent = code;
  document.getElementById("revoke-error").textContent = "";
  document.getElementById("revoke-modal").hidden = false;
}

function closeModals() {
  document.getElementById("extend-modal").hidden = true;
  document.getElementById("revoke-modal").hidden = true;
  extendTargetCode = null;
  revokeTargetCode = null;
}

async function renderQr(url) {
  const img = document.getElementById("result-qr");
  if (!img) return;
  try {
    const QRCode = await qrcodeReady;
    img.src = await QRCode.toDataURL(url, {
      width: 240,
      margin: 1,
      color: { dark: "#0B2545", light: "#FFFFFF" },
    });
  } catch (err) {
    console.warn("qr render failed", err);
  }
}

function showResult(record) {
  document.getElementById("generate-form-wrap").hidden = true;
  const result = document.getElementById("generate-result");
  result.hidden = false;

  const codeEl = document.getElementById("result-code");
  codeEl.textContent = record.code;
  // make the code copyable via data attribute
  codeEl.id = "result-code";

  const meta = document.getElementById("result-meta");
  const expiryLabel = record.expires_at ? `Expires ${fmtDate(record.expires_at)}` : "No expiration";
  meta.textContent = `${record.tier} · ${record.shop_name || "—"} · ${expiryLabel}`;

  const url = shareUrl(record.code);
  const urlInput = document.getElementById("result-url");
  urlInput.value = url;

  renderQr(url);
}

function resetGenerateForm() {
  document.getElementById("generate-result").hidden = true;
  document.getElementById("generate-form-wrap").hidden = false;
  const form = document.getElementById("generate-form");
  form.reset();
  document.getElementById("trial-select").value = "7";
  document.getElementById("custom-date-wrap").hidden = true;
  document.getElementById("generate-error").textContent = "";
}

function trialDaysToIso(days) {
  if (!days || days === "0") return null;
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Date.now() + n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

function customDateToIso(dateStr) {
  if (!dateStr) return null;
  // Treat as end-of-day UTC so a "7 days from today" date doesn't expire mid-morning
  const iso = `${dateStr}T23:59:59Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function bindDashboard() {
  // Sign out
  app.querySelector("[data-logout]").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch {}
    renderLogin();
  });

  // Trial select
  const trialSelect = document.getElementById("trial-select");
  const customWrap = document.getElementById("custom-date-wrap");
  trialSelect.addEventListener("change", () => {
    customWrap.hidden = trialSelect.value !== "custom";
  });

  // Generate form
  const form = document.getElementById("generate-form");
  const submitBtn = document.getElementById("generate-submit");
  const errEl = document.getElementById("generate-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const fd = new FormData(form);
    const shopName = String(fd.get("shopName") || "").trim();
    const brokerName = String(fd.get("brokerName") || "").trim();
    const tier = String(fd.get("tier") || "STUDIO").toUpperCase();
    const trial = String(fd.get("trial") || "0");
    let expiresAt = null;
    if (trial === "custom") {
      const customDate = String(fd.get("customDate") || "").trim();
      if (!customDate) {
        errEl.textContent = "Pick a custom expiration date.";
        return;
      }
      expiresAt = customDateToIso(customDate);
      if (!expiresAt) {
        errEl.textContent = "Invalid custom date.";
        return;
      }
    } else {
      expiresAt = trialDaysToIso(trial);
    }

    submitBtn.disabled = true;
    try {
      const data = await api("/api/admin/generate-code", {
        method: "POST",
        body: JSON.stringify({ shopName, brokerName, tier, expiresAt }),
      });
      showResult(data.code);
      await loadCodes();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById("generate-another").addEventListener("click", resetGenerateForm);

  // Copy buttons
  app.addEventListener("click", (e) => {
    const target = e.target.closest("[data-copy-target]");
    if (!target) return;
    const id = target.getAttribute("data-copy-target");
    const el = document.getElementById(id);
    if (!el) return;
    const text = el.value ?? el.textContent ?? "";
    copyText(text);
  });

  // Search + filter
  document.getElementById("search").addEventListener("input", (e) => {
    searchTerm = e.target.value;
    renderCodesTable();
  });
  app.querySelectorAll(".ad-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      app.querySelectorAll(".ad-filter").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      activeFilter = btn.getAttribute("data-filter");
      renderCodesTable();
    });
  });
  document.getElementById("refresh").addEventListener("click", loadCodes);

  // Row actions (delegated)
  app.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const code = btn.getAttribute("data-code");
    if (!action || !code) return;
    if (action === "copy") copyText(shareUrl(code));
    else if (action === "extend") openExtendModal(code);
    else if (action === "revoke") openRevokeModal(code);
  });

  // Modal close
  app.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", closeModals);
  });

  // Extend confirm
  document.getElementById("extend-confirm").addEventListener("click", async () => {
    if (!extendTargetCode) return;
    const errEl = document.getElementById("extend-error");
    errEl.textContent = "";
    const dateStr = document.getElementById("extend-date").value;
    const expiresAt = dateStr ? customDateToIso(dateStr) : null;
    try {
      await api("/api/admin/extend-code", {
        method: "POST",
        body: JSON.stringify({ code: extendTargetCode, expiresAt }),
      });
      closeModals();
      showToast("Updated expiration");
      await loadCodes();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Revoke confirm
  document.getElementById("revoke-confirm").addEventListener("click", async () => {
    if (!revokeTargetCode) return;
    const errEl = document.getElementById("revoke-error");
    errEl.textContent = "";
    try {
      await api("/api/admin/revoke-code", {
        method: "POST",
        body: JSON.stringify({ code: revokeTargetCode }),
      });
      closeModals();
      showToast("Code revoked");
      await loadCodes();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function renderDashboard() {
  renderTemplate("tpl-dashboard");
  bindDashboard();
  loadCodes();
}

async function mount() {
  try {
    const data = await api("/api/admin/me");
    if (data.authenticated) {
      renderDashboard();
      return;
    }
  } catch (err) {
    // 401 falls through to login
  }
  renderLogin();
}

mount();
