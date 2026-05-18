import Stripe from "stripe";
import {
  generateAccessCode,
  tierFromAmount,
  saveNewCode,
  deactivateCodeBySubscription,
  getSessionResult,
  markSessionProcessed,
} from "../_codes.js";
import { sendWelcomeEmail } from "../_email.js";

export const config = {
  api: { bodyParser: false },
  maxDuration: 15,
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function firstName(fullName) {
  if (!fullName) return null;
  const trimmed = String(fullName).trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

async function handleCheckoutCompleted(stripe, session) {
  const existingCode = await getSessionResult(session.id);
  if (existingCode) {
    console.log(`[stripe] session ${session.id} already processed -> ${existingCode}`);
    return existingCode;
  }

  const amountCents = session.amount_total;
  const tier = tierFromAmount(amountCents);

  const customerEmail =
    session.customer_details?.email || session.customer_email || null;
  if (!customerEmail) {
    throw new Error(`No customer email on session ${session.id}`);
  }
  const customerName = session.customer_details?.name || null;
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const stripeSubscriptionId =
    session.mode === "subscription"
      ? typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null
      : null;

  const code = generateAccessCode(tier);

  await saveNewCode({
    code,
    tier,
    customerEmail,
    stripeCustomerId,
    stripeSubscriptionId,
  });

  await sendWelcomeEmail({
    toEmail: customerEmail,
    firstName: firstName(customerName),
    code,
    tier,
  });

  await markSessionProcessed(session.id, code);

  console.log(`[stripe] issued ${code} (${tier}) to ${customerEmail} for session ${session.id}`);
  return code;
}

async function handleSubscriptionDeleted(subscription) {
  const subId = subscription.id;
  const code = await deactivateCodeBySubscription(subId);
  if (code) {
    console.log(`[stripe] deactivated code ${code} for canceled subscription ${subId}`);
  } else {
    console.log(`[stripe] no code found for subscription ${subId}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: "Stripe is not configured on this deployment." });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).json({ error: "Missing stripe-signature header" });
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe] signature verification failed:", err.message);
    return res.status(400).json({ error: `Signature verification failed: ${err.message}` });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(stripe, event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        console.log(`[stripe] ignoring event ${event.type}`);
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[stripe] handler error for ${event.type}:`, err);
    return res.status(500).json({ error: err.message ?? String(err) });
  }
}
