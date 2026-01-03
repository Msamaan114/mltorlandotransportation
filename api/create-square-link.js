// api/create-square-link.js
// Creates a Square-hosted checkout link (Payment Link) using Square Checkout API.
// Uses an ORDER (not quick_pay) so we can attach reference_id = bookingId.

export default async function handler(req, res) {
  const allowedOrigins = new Set([
    "https://mltorlandotransportation.com",
    "https://www.mltorlandotransportation.com",
  ]);

  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const {
      amount,
      currency = "USD",
      name = "MLT Orlando Transportation",
      note = "",
      bookingId = "",
      buyerEmail = "",
      buyerPhone = "",
      redirectPath = "/confirmation.html",
    } = req.body || {};

    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // Guardrails (optional)
    if (dollars < 1 || dollars > 5000) {
      return res.status(400).json({ ok: false, error: "Amount out of allowed range" });
    }

    const cents = Math.round(dollars * 100);

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();

    // Your public site base (used for redirect_url)
    const siteUrl =
      process.env.SITE_URL || "https://www.mltorlandotransportation.com"; // must be HTTPS :contentReference[oaicite:4]{index=4}
    const redirectUrl = new URL(redirectPath, siteUrl).toString();

    if (!accessToken || !locationId) {
      return res.status(500).json({
        ok: false,
        error: "Missing Square env vars",
        missing: {
          SQUARE_ACCESS_TOKEN: !accessToken,
          SQUARE_LOCATION_ID: !locationId,
        },
      });
    }

    const baseUrl =
      env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

    const idempotencyKey =
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    // Keep reference_id short & safe
    const safeBookingId = String(bookingId || "").slice(0, 60);

    const payload = {
      idempotency_key: idempotencyKey,

      // ORDER checkout (so we can attach reference_id)
      order: {
        location_id: locationId,
        reference_id: safeBookingId,
        line_items: [
          {
            name: name,
            quantity: "1",
            base_price_money: { amount: cents, currency },
          },
        ],
      },

      // Redirect after payment (Square appends orderId/transactionId/referenceId in production) :contentReference[oaicite:5]{index=5}
      checkout_options: {
        redirect_url: redirectUrl,
      },

      // Optional: prefill contact on checkout page
      pre_populated_data: {
        buyer_email: buyerEmail || undefined,
        buyer_phone_number: buyerPhone || undefined,
      },

      // Optional: gets attached to the resulting Payment :contentReference[oaicite:6]{index=6}
      payment_note: String(note || "").slice(0, 500),
    };

    const resp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2025-10-16",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: "Square error", details: data });
    }

    const url = data?.payment_link?.url || data?.payment_link?.long_url;
    if (!url) return res.status(500).json({ ok: false, error: "No URL returned", details: data });

    return res.status(200).json({
      ok: true,
      url,
      payment_link_id: data?.payment_link?.id,
      order_id: data?.payment_link?.order_id,
      redirect_url: redirectUrl,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
