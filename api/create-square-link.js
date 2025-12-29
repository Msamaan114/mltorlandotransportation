// /api/create-square-link.js
// Square Payment Link + CORS-robust (allows www + non-www, and avoids silent CORS failures)

export default async function handler(req, res) {
  // --- CORS ---
  const allowedOrigins = new Set([
    "https://mltorlandotransportation.com",
    "https://www.mltorlandotransportation.com",
  ]);

  const origin = req.headers.origin;

  // For TESTING: if origin is allowed, echo it back.
  // If origin is missing (curl/browser direct) we won't set it.
  // If you want "works no matter what" during testing, uncomment the fallback "*".
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  // TEMP DEBUG OPTION (uncomment for 5 minutes if you still get Failed to fetch):
  // else if (origin) {
  //   res.setHeader("Access-Control-Allow-Origin", origin);
  //   res.setHeader("Vary", "Origin");
  // }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400"); // cache preflight 24h

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const { amount, currency = "USD", name = "Transportation Service", note = "" } = req.body || {};

    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const cents = Math.round(dollars * 100);

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();

    if (!accessToken || !locationId) {
      return res.status(500).json({ ok: false, error: "Missing Square env vars" });
    }

    const baseUrl =
      env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

    const idempotencyKey =
      globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
        "Square-Version": "2025-10-16",
      },
      body: JSON.stringify(payload),
    });

    const data = await squareResp.json();

    if (!squareResp.ok) {
      return res.status(400).json({ ok: false, error: "Square error", details: data });
    }

    return res.status(200).json({
      ok: true,
      url: data?.payment_link?.url,
      long_url: data?.payment_link?.long_url,
      payment_link_id: data?.payment_link?.id,
      order_id: data?.payment_link?.order_id,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
