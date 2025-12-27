export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "API is working", env: process.env.SQUARE_ENV || "production" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Some Vercel setups don’t always parse JSON automatically in plain /api functions
  async function readJsonBody(request) {
    if (request.body && typeof request.body === "object") return request.body;

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  try {
    const bodyIn = await readJsonBody(req);
    const { amountCents, route, vehicle, tripType, hours } = bodyIn || {};

    const amt = Number(amountCents);
    if (!amt || Number.isNaN(amt) || amt < 50) {
      return res.status(400).json({ ok: false, error: "amountCents is required (number, >= 50)" });
    }

    // --- REQUIRED ENV VARS in Vercel ---
    // Use EXACT NAMES below in Vercel
    const accessToken = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_PROD;
    const locationId = process.env.SQUARE_LOCATION_ID || process.env.SQUARE_LOCATION_ID_PROD;

    // Optional (recommended)
    const redirectUrl =
      process.env.SQUARE_REDIRECT_URL ||
      "https://www.mltorlandotransportation.com/booking.html?paid=1";

    if (!accessToken || !locationId) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in Vercel.",
      });
    }

    // PRODUCTION base URL
    const baseUrl = "https://connect.squareup.com";

    // Idempotency key
    const idem = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const lineItemName = [
      route ? `Route: ${route}` : null,
      vehicle ? `Vehicle: ${vehicle}` : null,
      tripType ? `Trip: ${tripType}` : null,
      (route === "HOURLY" && tripType === "HOURLY" && hours) ? `Hours: ${hours}` : null,
    ].filter(Boolean).join(" | ") || "MLT Orlando Transportation";

    const payload = {
      idempotency_key: idem,
      order: {
        location_id: locationId,
        line_items: [
          {
            name: lineItemName,
            quantity: "1",
            base_price_money: {
              amount: Math.round(amt),
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
        // If you ever see version-related errors, remove this header.
        "Square-Version": "2024-06-04",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      // return full Square error so you can see EXACT cause in DevTools
      return res.status(resp.status).json({
        ok: false,
        error: "Square API error",
        details: data,
      });
    }

    const url = data?.payment_link?.url;
    if (!url) {
      return res.status(500).json({ ok: false, error: "No payment_link.url returned", details: data });
    }

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
