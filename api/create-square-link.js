// /api/create-square-link.js
// Vercel Serverless Function (Node)
// Works for Square PRODUCTION by default, but supports sandbox via SQUARE_ENV=sandbox

export default async function handler(req, res) {
  // --- CORS (lets your pages call this API) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "API is working",
      env: (process.env.SQUARE_ENV || "production").toLowerCase(),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { amountCents, route, vehicle, tripType } = req.body || {};

    const amountNum = Number(amountCents);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        ok: false,
        error: "amountCents is required (positive number)",
        received: amountCents,
      });
    }

    // --- REQUIRED ENV VARS in Vercel ---
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const squareEnv = (process.env.SQUARE_ENV || "production").toLowerCase(); // production | sandbox

    if (!accessToken || !locationId) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing env vars. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in Vercel (Production).",
      });
    }

    // Production vs Sandbox base URL
    const baseUrl =
      squareEnv === "sandbox"
        ? "https://connect.squareupsandbox.com"
        : "https://connect.squareup.com";

    // Idempotency key (simple + good enough)
    const idem = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const lineItemName =
      [route ? `Route: ${route}` : null, vehicle ? `Vehicle: ${vehicle}` : null, tripType ? `Trip: ${tripType}` : null]
        .filter(Boolean)
        .join(" | ") || "MLT Orlando Transportation";

    // IMPORTANT:
    // Use your real domain here if you want customers returned to booking page after payment.
    const redirectUrl =
      process.env.SQUARE_REDIRECT_URL ||
      "https://www.mltorlandotransportation.com/booking.html?paid=1";

    const body = {
      idempotency_key: idem,
      order: {
        location_id: locationId,
        line_items: [
          {
            name: lineItemName,
            quantity: "1",
            base_price_money: {
              amount: Math.round(amountNum),
              currency: "USD",
            },
          },
        ],
      },
      checkout_options: {
        redirect_url: redirectUrl,
      },
    };

    const resp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // If Square rejects the version header, just delete this line.
        "Square-Version": "2025-01-23",
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Square API error",
        squareEnv,
        baseUrl,
        details: data,
      });
    }

    const url = data?.payment_link?.url;
    if (!url) {
      return res.status(500).json({
        ok: false,
        error: "No payment_link.url returned",
        squareEnv,
        details: data,
      });
    }

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
