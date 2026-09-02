import type { VercelRequest, VercelResponse } from "@vercel/node";
import { confirm } from "./_lib/subscribers.js";
import { resultPage } from "./_lib/resultPage.js";

// GET /api/confirm?token=...
// Validates the confirmation token and activates the subscriber, then renders a
// branded HTML page. The email address is never shown in the URL or the page.
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const token = typeof req.query.token === "string" ? req.query.token : "";

  let html: string;
  let status = 200;

  try {
    const outcome = await confirm(token);
    switch (outcome) {
      case "confirmed":
        html = resultPage({
          title: "Email confirmed",
          heading: "You’re on the list 🎉",
          body: "Your email is confirmed. We’ll let you know the moment the shop and checkout go live.",
          tone: "success",
        });
        break;
      case "already_active":
        html = resultPage({
          title: "Already confirmed",
          heading: "You’re already subscribed",
          body: "This email is already confirmed — no further action needed. We’ll be in touch at launch.",
          tone: "neutral",
        });
        break;
      case "expired":
        status = 410;
        html = resultPage({
          title: "Link expired",
          heading: "This link has expired",
          body: "For your security, confirmation links expire. Please sign up again on our site to get a fresh link.",
          tone: "error",
        });
        break;
      default:
        status = 400;
        html = resultPage({
          title: "Invalid link",
          heading: "We couldn’t confirm this link",
          body: "This confirmation link is invalid or has already been used. Please sign up again if you’d like launch updates.",
          tone: "error",
        });
    }
  } catch (err) {
    console.error("[/api/confirm] error:", err);
    status = 500;
    html = resultPage({
      title: "Something went wrong",
      heading: "Something went wrong",
      body: "We hit a snag confirming your email. Please try again in a few minutes.",
      tone: "error",
    });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(status).send(html);
}
