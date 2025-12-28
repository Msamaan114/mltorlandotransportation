// /api/create-square-link.js
// Creates a Square-hosted checkout link (Payment Link) using Square Checkout API.
// CORS Fix #2: allow BOTH www and non-www origins.

export default async function handler(req, res) {
  // ---- CORS (Fix 2) ----
  const allowedOrigins = new Set([
    "https://mltorlandotransportation.com",
    "https://www.mltorlandotransportation.com",
  ]);

  const origin = req.headers.origin;

  // Only echo back the origin if it is in our allowlist
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    // Ensure caches treat different Origins separately
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const { amount, currency = "USD", name = "Transportation Service", note = "" } = req.body || {};

    // Validate amount: expect dollars as number/string, convert to cents
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // Guardrails (adjust as you like)
    if (dollars < 1 || dollars > 5000) {
      return res.status(400).json({ ok: false, error: "Amount out of allowed range" });
    }

    const cents = Math.round(dollars * 100);

    // ---- Square env vars (set in Vercel) ----
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;

    // use SQUARE_ENV = "production" or "sandbox"
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();

    if (!accessToken || !locationId) {
      return res.status(500).json({ ok: false, error: "Missing Square env vars" });
    }

    // Square base URLs:
    // Production: https://connect.squareup.com
    // Sandbox:    https://connect.squareupsandbox.com
    const baseUrl =
      env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

    const idempotencyKey =
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    // Payload for CreatePaymentLink
    const payload = {
      idempotency_key: idempotencyKey,
      quick_pay: {
        name,
        price_money: { amount: cents, currency },
        location_id: locationId,
      },
      payment_note: note,
    };

    const squareResp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // You can keep this or update to a newer Square-Version later
        "Square-Version": "2025-10-16",
      },
      body: JSON.stringify(payload),
    });

    const data = await squareResp.json();

    if (!squareResp.ok) {
      return res.status(400).json({
        ok: false,
        error: "Square error",
        details: data,
      });
    }

    // Return the checkout link
    return res.status(200).json({
      ok: true,
      url: data?.payment_link?.url,
      long_url: data?.payment_link?.long_url,
      order_id: data?.payment_link?.order_id,
      payment_link_id: data?.payment_link?.id,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
