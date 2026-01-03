// api/create-square-link.js
export default async function handler(req, res) {
  const allowedOrigins = new Set([
    "https://mltorlandotransportation.com",
    "https://www.mltorlandotransportation.com",
  ]);

  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const {
      amount,
      currency = "USD",
      // show on Square checkout
      lineItemName = "Transportation Service",
      // show in Square dashboard order note
      note = "",
      // your internal booking id (keep <= 40 chars)
      referenceId = "",
      // where Square should send them back
      redirectUrl = "",
      // optional prefill
      buyerEmail = "",
      buyerPhone = "",
    } = req.body || {};

    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }
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
        missing: { SQUARE_ACCESS_TOKEN: !accessToken, SQUARE_LOCATION_ID: !locationId },
      });
    }

    const baseUrl =
      env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

    const idempotencyKey =
      globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Use an ORDER so you can set reference_id + redirect_url
    const payload = {
      idempotency_key: idempotencyKey,
      order: {
        location_id: locationId,
        reference_id: referenceId ? String(referenceId).slice(0, 40) : undefined,
        note: note ? String(note).slice(0, 2000) : undefined,
        line_items: [
          {
            name: String(lineItemName).slice(0, 512),
            quantity: "1",
            base_price_money: { amount: cents, currency },
          },
        ],
      },
      checkout_options: redirectUrl
        ? {
            redirect_url: redirectUrl,
          }
        : undefined,
      pre_populated_data:
        buyerEmail || buyerPhone
          ? {
              buyer_email: buyerEmail || undefined,
              buyer_phone_number: buyerPhone || undefined,
            }
          : undefined,
    };

    // Clean undefined keys (Square can be picky)
    const clean = JSON.parse(JSON.stringify(payload));

    const resp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // Current Checkout API versions are date-based; this is valid and commonly used.
        "Square-Version": "2025-10-16",
      },
      body: JSON.stringify(clean),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: "Square error", details: data });
    }

    const url = data?.payment_link?.url;
    if (!url) return res.status(500).json({ ok: false, error: "No URL returned", details: data });

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Server error", message: err?.message || String(err) });
  }
}
