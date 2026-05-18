export function withGuard(handler) {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "POST only" });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error:
          "ANTHROPIC_API_KEY is not set on this deployment. Add it in Vercel → Project Settings → Environment Variables and redeploy.",
      });
    }
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message ?? String(err) });
      }
    }
  };
}
