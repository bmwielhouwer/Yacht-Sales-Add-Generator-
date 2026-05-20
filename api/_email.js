import { Resend } from "resend";

const TIER_LABELS = {
  LISTING: "Per Listing",
  STUDIO: "Listing Studio",
  SUITE: "Full Suite",
};

const APP_URL = "https://yacht-sales-add-generator.vercel.app";
const BILLING_PORTAL_URL = "https://billing.stripe.com/p/login/dRm00c7mEbUOg7Ie2U9AA00";

let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function welcomeHtml({ firstName, code, tier }) {
  const safeName = escapeHtml(firstName);
  const safeCode = escapeHtml(code);
  const tierLabel = escapeHtml(TIER_LABELS[tier] ?? tier);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F7F7F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A1A;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F7F4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #e6e3dc;border-radius:12px;box-shadow:0 2px 8px rgba(11,37,69,0.06);">
            <tr>
              <td style="padding:32px 36px 8px 36px;border-bottom:1px solid #e6e3dc;">
                <div style="font-size:20px;font-weight:500;color:#0B2545;letter-spacing:-0.01em;">Compass Line Marine</div>
                <div style="font-size:12px;color:#5F5F5F;margin-top:4px;">by Compass Line Ventures</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 36px 8px 36px;">
                <h1 style="margin:0 0 12px 0;font-family:Georgia,serif;font-weight:500;font-size:26px;color:#0B2545;line-height:1.2;">Welcome aboard, ${safeName}.</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#1A1A1A;">
                  Your <strong>${tierLabel}</strong> subscription is active. Below is the access code that unlocks the listing generator.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F7F4;border:1px solid #C8A951;border-radius:10px;">
                  <tr>
                    <td style="padding:18px 20px;text-align:center;">
                      <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#5F5F5F;margin-bottom:8px;">Your access code</div>
                      <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:22px;font-weight:600;color:#0B2545;letter-spacing:0.06em;">${safeCode}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 36px 8px 36px;">
                <h2 style="margin:0 0 12px 0;font-size:14px;font-weight:600;color:#0B2545;text-transform:uppercase;letter-spacing:0.05em;">How to get started</h2>
                <ol style="margin:0;padding-left:20px;font-size:15px;line-height:1.7;color:#1A1A1A;">
                  <li>Open the app at <a href="${APP_URL}" style="color:#2A6F6F;text-decoration:none;">${APP_URL}</a>.</li>
                  <li>Paste your access code when the welcome screen prompts you.</li>
                  <li>Paste broker notes, drop in photos, and click <em>Generate listing</em>.</li>
                </ol>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px;">
                <a href="${APP_URL}" style="display:inline-block;background:#C8A951;color:#FFFFFF;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;text-decoration:none;">Open the app →</a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 36px 32px 36px;">
                <p style="margin:0 0 6px 0;font-size:13px;color:#5F5F5F;line-height:1.55;">
                  Manage your subscription, update payment, or cancel anytime in the <a href="${BILLING_PORTAL_URL}" style="color:#2A6F6F;text-decoration:none;">billing portal</a>.
                </p>
                <p style="margin:0;font-size:13px;color:#5F5F5F;line-height:1.55;">
                  Questions? Reply to this email or write to <a href="mailto:brianwielhouwer@gmail.com" style="color:#2A6F6F;text-decoration:none;">brianwielhouwer@gmail.com</a>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 36px;background:#F7F7F4;border-top:1px solid #e6e3dc;border-radius:0 0 12px 12px;font-size:12px;color:#5F5F5F;">
                Compass Line Ventures · Built for serious yacht brokers
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function inquiryHtml({ broker, lead, listing }) {
  const safeBroker = escapeHtml(broker?.name || "there");
  const boatName = escapeHtml(listing?.boatName || "your listing");
  const safeLeadName = escapeHtml(lead.name);
  const safeLeadEmail = escapeHtml(lead.email);
  const safeLeadPhone = lead.phone ? escapeHtml(lead.phone) : "";
  const safeMessage = lead.message ? escapeHtml(lead.message).replace(/\n/g, "<br>") : "";
  const tags = [];
  if (lead.cash_buyer) tags.push("Cash buyer");
  if (lead.trade_in) tags.push("Has trade-in");
  if (lead.financing) tags.push("Needs financing");
  const tagPills = tags
    .map(
      (t) =>
        `<span style="display:inline-block;background:#F7F7F4;border:1px solid #C8A951;color:#0B2545;border-radius:999px;padding:3px 10px;font-size:12px;margin-right:6px;">${escapeHtml(t)}</span>`,
    )
    .join("");
  const tagsRow = tags.length
    ? `<tr><td style="padding:8px 0;font-size:13px;color:#5F5F5F;">${tagPills}</td></tr>`
    : "";
  const phoneRow = safeLeadPhone
    ? `<tr><td style="padding:6px 0;font-size:14px;"><strong style="color:#5F5F5F;font-weight:500;">Phone:</strong> <a href="tel:${safeLeadPhone}" style="color:#0B2545;text-decoration:none;">${safeLeadPhone}</a></td></tr>`
    : "";
  const messageBlock = safeMessage
    ? `<tr><td style="padding:14px 0 0 0;"><div style="font-size:12px;font-weight:600;color:#5F5F5F;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Message</div><div style="background:#F7F7F4;border-left:3px solid #C8A951;padding:12px 14px;border-radius:4px;font-size:14px;line-height:1.55;color:#1A1A1A;">${safeMessage}</div></td></tr>`
    : "";
  const viewLink = listing?.url
    ? `<a href="${escapeHtml(listing.url)}" style="color:#2A6F6F;text-decoration:none;font-size:13px;">View listing →</a>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F7F7F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A1A;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F7F4;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #e6e3dc;border-radius:12px;box-shadow:0 2px 8px rgba(11,37,69,0.06);">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #e6e3dc;">
        <div style="font-size:11px;font-weight:600;color:#C8A951;letter-spacing:0.1em;text-transform:uppercase;">New Inquiry</div>
        <div style="font-size:20px;font-weight:500;color:#0B2545;margin-top:6px;">${boatName}</div>
        ${viewLink ? `<div style="margin-top:6px;">${viewLink}</div>` : ""}
      </td></tr>
      <tr><td style="padding:24px 32px;">
        <p style="margin:0 0 14px 0;font-size:15px;color:#1A1A1A;">Hi ${safeBroker} — a buyer just submitted an inquiry on your listing.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td style="padding:6px 0;font-size:14px;"><strong style="color:#5F5F5F;font-weight:500;">Name:</strong> ${safeLeadName}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;"><strong style="color:#5F5F5F;font-weight:500;">Email:</strong> <a href="mailto:${safeLeadEmail}" style="color:#0B2545;text-decoration:none;">${safeLeadEmail}</a></td></tr>
          ${phoneRow}
          ${tagsRow}
          ${messageBlock}
        </table>
      </td></tr>
      <tr><td style="padding:18px 32px;background:#F7F7F4;border-top:1px solid #e6e3dc;border-radius:0 0 12px 12px;font-size:12px;color:#5F5F5F;">
        Compass Line Marine · Reply directly to reach the buyer.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export async function sendInquiryEmail({ broker, lead, listing }) {
  const resend = getResend();
  if (!broker?.email) throw new Error("Broker email missing on the saved listing");
  const subj = listing?.boatName
    ? `New inquiry: ${listing.boatName}`
    : "New inquiry on your listing";
  console.log("[inquiry-email] sending", {
    to: broker.email,
    from: "Compass Line Marine <noreply@compasslineventures.com>",
    replyTo: lead.email,
    subject: subj,
  });
  const { data, error } = await resend.emails.send({
    from: "Compass Line Marine <noreply@compasslineventures.com>",
    to: broker.email,
    replyTo: lead.email,
    subject: subj,
    html: inquiryHtml({ broker, lead, listing }),
  });
  if (error) {
    console.error("[inquiry-email] resend rejected", {
      name: error?.name,
      message: error?.message,
      statusCode: error?.statusCode,
      raw: error,
    });
    throw new Error(`Resend rejected: ${error.message || error.name || JSON.stringify(error)}`);
  }
  console.log("[inquiry-email] sent", { id: data?.id });
  return data;
}

export async function sendWelcomeEmail({ toEmail, firstName, code, tier }) {
  const resend = getResend();
  const html = welcomeHtml({ firstName: firstName || "there", code, tier });
  const { data, error } = await resend.emails.send({
    from: "Compass Line Marine <noreply@compasslineventures.com>",
    to: toEmail,
    subject: "Welcome to Compass Line Marine — your access code",
    html,
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message || JSON.stringify(error)}`);
  }
  return data;
}
