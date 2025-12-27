export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, message: "API is working" });

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { amountCents, route, vehicle, tripType } = req.body || {};

    const cents = Number(amountCents);
    if (!Number.isFinite(cents) || cents <= 0) {
      return res.status(400).json({
        ok: false,
        error: "amountCents is required and must be a positive number",
        got: amountCents,
      });
    }

    // REQUIRED ENV VARS (set in Vercel)
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;

    // Choose env: sandbox or production
    // In Vercel set: SQUARE_ENV=sandbox   (or production)
    const squareEnv = (process.env.SQUARE_ENV || "sandbox").toLowerCase();
    const baseUrl =
      squareEnv === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    if (!accessToken || !locationId) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in Vercel.",
      });
    }

    // Idempotency key
    const idem = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const lineItemName =
      [
        route ? `Route: ${route}` : null,
        vehicle ? `Vehicle: ${vehicle}` : null,
        tripType ? `Trip: ${tripType}` : null,
      ]
        .filter(Boolean)
        .join(" | ") || "MLT Orlando Transportation";

    const body = {
      idempotency_key: idem,
      order: {
        location_id: locationId,
        line_items: [
          {
            name: lineItemName,
            quantity: "1",
            base_price_money: {
              amount: Math.round(cents),
              currency: "USD",
            },
          },
        ],
      },
      checkout_options: {
        // Make sure this matches how your site is actually served (www vs non-www)
        redirect_url: "https://www.mltorlandotransportation.com/booking.html?paid=1",
      },
    };

    const resp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        // NOTE: omit Square-Version to avoid version header issues
      },
      body: JSON.stringify(body),
    });

    // Read raw text first, then try to parse as JSON
    const raw = await resp.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { raw };
    }

    if (!resp.ok) {
      // This will now show real Square errors in your browser console
      return res.status(resp.status).json({
        ok: false,
        error: "Square API error",
        squareEnv,
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
