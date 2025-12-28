// /api/create-payment-link.js
// Creates a Square-hosted checkout link (Payment Link) using Square Checkout API.
// Docs: POST /v2/online-checkout/payment-links :contentReference[oaicite:1]{index=1}

export default async function handler(req, res) {
  // CORS (tighten origin in production)
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://mltorlandotransportation.com";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
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

    // Example guardrails (adjust to your business)
    if (dollars < 1 || dollars > 5000) {
      return res.status(400).json({ ok: false, error: "Amount out of allowed range" });
    }

    const cents = Math.round(dollars * 100);

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();

    if (!accessToken || !locationId) {
      return res.status(500).json({ ok: false, error: "Missing Square env vars" });
    }

    // Square base URLs:
    // Production: https://connect.squareup.com
    // Sandbox:    https://connect.squareupsandbox.com :contentReference[oaicite:2]{index=2}
    const baseUrl =
      env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

    const idempotencyKey =
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const payload = {
      idempotency_key: idempotencyKey,
      quick_pay: {
        name,
        price_money: { amount: cents, currency },
        location_id: locationId,
      },
      // Optional: adds a note to the resulting Payment :contentReference[oaicite:3]{index=3}
      payment_note: note,
      // You can also add checkout_options.redirect_url, custom fields, tipping, etc.
    };

    const squareResp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // Pinning the Square-Version is recommended; the API reference shows current versions. :contentReference[oaicite:4]{index=4}
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

    // Response includes payment_link.url / long_url :contentReference[oaicite:5]{index=5}
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
