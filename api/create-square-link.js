// api/create-square-link.js

module.exports = async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  // Helpful health check
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "API is working",
      env: process.env.SQUARE_ENV || "production",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Vercel sometimes gives req.body as object, sometimes string
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ ok: false, error: "Invalid JSON body" });
      }
    }

    const { amountCents, route, vehicle, tripType } = body || {};

    const amount = Number(amountCents);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: "amountCents is required and must be > 0 (number)" });
    }

    // --- REQUIRED ENV VARS ---
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const redirectUrl =
      process.env.SQUARE_REDIRECT_URL ||
      "https://www.mltorlandotransportation.com/booking.html?paid=1";

    if (!accessToken || !locationId) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing env vars. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in Vercel (Production).",
      });
    }

    // Choose base URL
    const squareEnv = (process.env.SQUARE_ENV || "production").toLowerCase();
    const baseUrl =
      squareEnv === "sandbox"
        ? "https://connect.squareupsandbox.com"
        : "https://connect.squareup.com";

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
            base_price_money: { amount: Math.round(amount), currency: "USD" },
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
        // If you ever suspect version issues, you can remove this header entirely.
        // "Square-Version": "2025-01-23",
      },
      body: JSON.stringify(payload),
    });

    const dataText = await resp.text();
    let data;
    try {
      data = JSON.parse(dataText);
    } catch {
      data = { raw: dataText };
    }

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Square API error",
        status: resp.status,
        details: data, // <--- THIS is what we need to see for the 400
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
};
