import { readSession } from "../_dashboard.js";

export const config = { maxDuration: 5 };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const session = readSession(req);
  if (!session?.email) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  return res.status(200).json({ email: session.email });
}
