// api/confirm-booking.js
// 1) Verify Square order is paid (has tenders)
// 2) Send reservation email via Formspree (only after payment)

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
    const { orderId, booking } = req.body || {};
    if (!orderId || !booking) {
      return res.status(400).json({ ok: false, error: "Missing orderId or booking" });
    }

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();
    const baseUrl =
      env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

    if (!accessToken) {
      return res.status(500).json({ ok: false, error: "Missing SQUARE_ACCESS_TOKEN" });
    }

    // Verify order
    const orderResp = await fetch(`${baseUrl}/v2/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2025-10-16",
      },
    });

    const orderData = await orderResp.json().catch(() => ({}));
    if (!orderResp.ok) {
      return res.status(orderResp.status).json({
        ok: false,
        error: "Failed to retrieve order",
        details: orderData,
      });
    }

    const order = orderData?.order;
    const tenders = order?.tenders || [];
    const isPaid = Array.isArray(tenders) && tenders.length > 0;

    if (!isPaid) {
      return res.status(400).json({
        ok: false,
        error: "Order not paid (no tenders found yet)",
        order_state: order?.state,
      });
    }

    // Send email via Formspree (ONLY after payment)
    // Put your real Formspree endpoint in Vercel env: FORMSPREE_CONFIRM_ENDPOINT
    const formspreeEndpoint = process.env.FORMSPREE_CONFIRM_ENDPOINT;
    if (!formspreeEndpoint) {
      return res.status(500).json({ ok: false, error: "Missing FORMSPREE_CONFIRM_ENDPOINT" });
    }

    const emailPayload = {
      ...booking,
      square_order_id: orderId,
      square_payment_id: tenders?.[0]?.id || "", // tender.id maps to Payment ID in this flow :contentReference[oaicite:7]{index=7}
      square_order_state: order?.state || "",
      confirmed_at: new Date().toISOString(),
    };

    const mailResp = await fetch(formspreeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    if (!mailResp.ok) {
      const txt = await mailResp.text().catch(() => "");
      return res.status(502).json({ ok: false, error: "Failed to send email", details: txt });
    }

    return res.status(200).json({ ok: true, message: "Booking confirmed + email sent" });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
