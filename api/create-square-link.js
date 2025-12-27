// /api/create-square-link.js

export default async function handler(req, res) {
  // Allow only POST (your earlier GET log entry is normal if you opened the URL in a browser)
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    // --- ENV ---
    const SQUARE_ENV = (process.env.SQUARE_ENV || "sandbox").toLowerCase();
    const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
    const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
    const SQUARE_VERSION = process.env.SQUARE_VERSION || "2025-10-16";

    if (!ACCESS_TOKEN || !LOCATION_ID) {
      console.error("Missing env vars", {
        hasToken: !!ACCESS_TOKEN,
        hasLocationId: !!LOCATION_ID,
        SQUARE_ENV,
        SQUARE_VERSION,
      });
      return res.status(500).json({
        error: "Server misconfigured: missing env vars",
        missing: {
          SQUARE_ACCESS_TOKEN: !ACCESS_TOKEN,
          SQUARE_LOCATION_ID: !LOCATION_ID,
        },
      });
    }

    const baseUrl =
      SQUARE_ENV === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    // --- INPUT ---
    const { route, vehicle, tripType, amountCents, description } = req.body || {};

    if (!amountCents || typeof amountCents !== "number") {
      return res.status(400).json({
        error: "amountCents is required and must be a number",
        example: { amountCents: 12000, route: "MCO_DISNEY", vehicle: "SEDAN", tripType: "ONEWAY" },
      });
    }

    // --- Build Square CreatePaymentLink payload ---
    const idempotencyKey =
      (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random()}`;

    const payload = {
      idempotency_key: idempotencyKey,
      order: {
        location_id: LOCATION_ID,
        line_items: [
          {
            name: description || `MLT Ride: ${route || ""} ${vehicle || ""} ${tripType || ""}`.trim(),
            quantity: "1",
            base_price_money: {
              amount: amountCents,
              currency: "USD",
            },
          },
        ],
      },
    };

    console.log("Creating payment link:", {
      env: SQUARE_ENV,
      location: LOCATION_ID,
      amountCents,
      route,
      vehicle,
      tripType,
    });

    const squareRes = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Square-Version": SQUARE_VERSION,
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await squareRes.text(); // IMPORTANT: always read text first
    console.log("Square status:", squareRes.status);
    console.log("Square body:", rawText);

    // Try parse JSON if possible
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (_) {}

    if (!squareRes.ok) {
      // Return Square error details to the browser
      return res.status(502).json({
        error: "Square API error",
        squareStatus: squareRes.status,
        squareBody: parsed || rawText || null,
      });
    }

    const paymentLink = parsed?.payment_link;
    return res.status(200).json({
      ok: true,
      url: paymentLink?.url,
      long_url: paymentLink?.long_url,
      id: paymentLink?.id,
    });
  } catch (err) {
    console.error("Function crash:", err);
    return res.status(502).json({
      error: "Serverless function crashed",
      message: err?.message || String(err),
    });
  }
}
