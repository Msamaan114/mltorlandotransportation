export default async function handler(req, res) {
  // --- CORS (lets your pages call this API) ---
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

    if (!amountCents || Number.isNaN(Number(amountCents))) {
      return res.status(400).json({ ok: false, error: "amountCents is required (number)" });
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

    // Sandbox base URL
    const baseUrl = "https://connect.squareupsandbox.com";

    // Idempotency key (simple + good enough)
    const idem = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const lineItemName = [
      route ? `Route: ${route}` : null,
      vehicle ? `Vehicle: ${vehicle}` : null,
      tripType ? `Trip: ${tripType}` : null,
    ].filter(Boolean).join(" | ") || "MLT Orlando Transportation";

    const body = {
      idempotency_key: idem,
      order: {
        location_id: locationId,
        line_items: [
          {
            name: lineItemName,
            quantity: "1",
            base_price_money: {
              amount: Number(amountCents),
              currency: "USD",
            },
          },
        ],
      },
      checkout_options: {
        // change this to your real thank-you page if you want
        redirect_url: "https://mltorlandotransportation.com/booking.html?paid=1",
      },
    };

    const resp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2025-01-23", // ok if Square accepts; if this errors, remove this line
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (!resp.ok) {
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
