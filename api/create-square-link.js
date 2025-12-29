// api/create-square-link.js
// Creates a Square-hosted checkout link (Payment Link) using Square Checkout API.

export default async function handler(req, res) {
  // CORS (allow your site + www)
  const allowedOrigins = new Set([
    "https://mltorlandotransportation.com",
    "https://www.mltorlandotransportation.com",
  ]);

  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const { amount, currency = "USD", name = "Transportation Service", note = "" } = req.body || {};

    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // Guardrails (optional)
    if (dollars < 1 || dollars > 5000) {
      return res.status(400).json({ ok: false, error: "Amount out of allowed range" });
    }

    const cents = Math.round(dollars * 100);

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();

    if (!accessToken || !locationId) {
      return res.status(500).json({
        ok: false,
        error: "Missing Square env vars",
        missing: {
          SQUARE_ACCESS_TOKEN: !accessToken,
          SQUARE_LOCATION_ID: !locationId,
        },
      });
    }

    const baseUrl =
      env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

    const idempotencyKey =
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    // IMPORTANT: include location_id in quick_pay
    const payload = {
      idempotency_key: idempotencyKey,
      quick_pay: {
        name,
        location_id: locationId,
        price_money: { amount: cents, currency },
      },
      // Optional: show note on receipt / order (not required)
      // pre_populated_data: { buyer_note: note },
    };

    const resp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2025-01-23",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      // Return Square’s details so you can see the real reason in DevTools
      return res.status(resp.status).json({
        ok: false,
        error: "Square error",
        details: data,
      });
    }

    const url = data?.payment_link?.url;
    if (!url) {
      return res.status(500).json({ ok: false, error: "No URL returned", details: data });
    }

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
