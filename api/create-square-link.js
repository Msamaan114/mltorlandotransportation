export default async function handler(req, res) {
  // --- CORS (lets your pages call this API) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  // Health check
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "API is working",
      env: process.env.NODE_ENV || "unknown",
      squareEnv: process.env.SQUARE_ENV || "production-default",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Robust JSON parsing (works for Vercel functions + other setups)
  async function readJsonBody(request) {
    if (request.body && typeof request.body === "object") return request.body;

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  try {
    const bodyIn = await readJsonBody(req);
    const { amountCents, route, vehicle, tripType } = bodyIn || {};

    const amountNum = Number(amountCents);
    if (!amountCents || Number.isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        ok: false,
        error: "amountCents is required (positive number)",
        received: amountCents,
      });
    }

    // --- REQUIRED ENV VARS in Vercel (Production env) ---
    const accessToken = process.env.SQUARE_ACCESS_TOKEN; // PRODUCTION token
    const locationId = process.env.SQUARE_LOCATION_ID;   // PRODUCTION location

    if (!accessToken || !locationId) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing env vars. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in Vercel (Production environment).",
      });
    }

    // Use production Square base URL
    // (You can optionally set SQUARE_ENV=sandbox if you ever want to test again.)
    const squareEnv = (process.env.SQUARE_ENV || "production").toLowerCase();
    const baseUrl =
      squareEnv === "sandbox"
        ? "https://connect.squareupsandbox.com"
        : "https://connect.squareup.com";

    // Idempotency key
    const idem = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const lineItemName =
      [route ? `Route: ${route}` : null, vehicle ? `Vehicle: ${vehicle}` : null, tripType ? `Trip: ${tripType}` : null]
        .filter(Boolean)
        .join(" | ") || "MLT Orlando Transportation";

    const payload = {
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
        // Change to your real thank-you page if you want
        redirect_url: "https://www.mltorlandotransportation.com/booking.html?paid=1",
      },
    };

    const resp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // NOTE: intentionally NOT setting Square-Version here to avoid version mismatch errors
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Square API error",
        status: resp.status,
        details: data,
      });
    }

    const url = data?.payment_link?.url;
    if (!url) {
      return res.status(500).json({
        ok: false,
        error: "No payment_link.url returned",
        details: data,
      });
    }

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
