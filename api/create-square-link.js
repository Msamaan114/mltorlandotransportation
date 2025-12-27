export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
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
    // Vercel sometimes gives req.body as an object, sometimes as a string
    const bodyIn = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { amountCents, route, vehicle, tripType } = bodyIn;

    const amt = Number(amountCents);
    if (!Number.isFinite(amt) || amt <= 0 || !Number.isInteger(amt)) {
      return res.status(400).json({
        ok: false,
        error: "amountCents must be a positive integer (e.g. 12000 for $120.00)",
      });
    }

    // --- REQUIRED ENV VARS in Vercel ---
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;

    if (!accessToken || !locationId) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in Vercel.",
      });
    }

    // Choose environment
    const squareEnv = (process.env.SQUARE_ENV || "production").toLowerCase();
    // Production vs Sandbox base URL are different :contentReference[oaicite:1]{index=1}
    const baseUrl =
      squareEnv === "sandbox"
        ? "https://connect.squareupsandbox.com"
        : "https://connect.squareup.com";

    const redirectUrl =
      process.env.SQUARE_REDIRECT_URL ||
      "https://www.mltorlandotransportation.com/booking.html?paid=1";

    // Idempotency key
    const idem = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const lineItemName = [
      route ? `Route: ${route}` : null,
      vehicle ? `Vehicle: ${vehicle}` : null,
      tripType ? `Trip: ${tripType}` : null,
    ]
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
            base_price_money: { amount: amt, currency: "USD" },
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
        // Use a known-valid Square-Version date (your previous one can trigger 400)
        "Square-Version": "2025-03-19", // :contentReference[oaicite:2]{index=2}
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      // Return Square errors clearly so you can see them in Network -> Response
      return res.status(resp.status).json({
        ok: false,
        error: "Square API error",
        squareEnv,
        status: resp.status,
        squareErrors: data?.errors || null,
        raw: data,
      });
    }

    const url = data?.payment_link?.url;
    if (!url) {
      return res.status(500).json({
        ok: false,
        error: "No payment_link.url returned",
        squareEnv,
        raw: data,
      });
    }

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
