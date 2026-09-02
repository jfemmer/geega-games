import type { VercelRequest, VercelResponse } from "@vercel/node";
import { unsubscribe } from "./_lib/subscribers.js";
import { resultPage } from "./_lib/resultPage.js";

// GET /api/unsubscribe?token=...
// Unsubscribes the holder of a valid unsubscribe token from MARKETING email.
// This never affects transactional order emails.
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const token = typeof req.query.token === "string" ? req.query.token : "";

  let html: string;
  let status = 200;

  try {
    const outcome = await unsubscribe(token);
    if (outcome === "unsubscribed") {
      html = resultPage({
        title: "Unsubscribed",
        heading: "You’ve been unsubscribed",
        body: "You won’t receive further marketing emails from Geega Games. You’ll still get essential emails about any orders you place.",
        tone: "success",
      });
    } else {
      status = 400;
      html = resultPage({
        title: "Invalid link",
        heading: "We couldn’t process this link",
        body: "This unsubscribe link is invalid or has already been used. If you keep receiving emails, reply to any of them and we’ll remove you.",
        tone: "error",
      });
    }
  } catch (err) {
    console.error("[/api/unsubscribe] error:", err);
    status = 500;
    html = resultPage({
      title: "Something went wrong",
      heading: "Something went wrong",
      body: "We hit a snag processing your request. Please try again shortly.",
      tone: "error",
    });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(status).send(html);
}
