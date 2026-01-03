// api/confirm-booking.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const { cid = "", orderId, transactionId = "", booking } = req.body || {};
    if (!orderId) return res.status(400).json({ ok: false, error: "Missing orderId" });
    if (!booking) return res.status(400).json({ ok: false, error: "Missing booking data" });

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();
    const baseUrl =
      env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

    if (!accessToken) return res.status(500).json({ ok: false, error: "Missing SQUARE_ACCESS_TOKEN" });

    // 1) Retrieve order
    const oResp = await fetch(`${baseUrl}/v2/orders/${encodeURIComponent(orderId)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2025-10-16",
      },
    });
    const oData = await oResp.json().catch(() => ({}));
    if (!oResp.ok) return res.status(oResp.status).json({ ok: false, error: "RetrieveOrder failed", details: oData });

    const order = oData?.order;
    const paymentId = order?.tenders?.[0]?.payment_id;

    if (!paymentId) {
      // can be a timing issue (payment not attached yet)
      return res.status(200).json({ ok: false, error: "Payment not attached yet. Please refresh in 10 seconds." });
    }

    // 2) Retrieve payment (optional but recommended)
    const pResp = await fetch(`${baseUrl}/v2/payments/${encodeURIComponent(paymentId)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2025-10-16",
      },
    });
    const pData = await pResp.json().catch(() => ({}));
    if (!pResp.ok) return res.status(pResp.status).json({ ok: false, error: "GetPayment failed", details: pData });

    const payment = pData?.payment;
    if (payment?.status !== "COMPLETED") {
      return res.status(200).json({ ok: false, error: `Payment not completed (${payment?.status || "UNKNOWN"})` });
    }

    // 3) Email YOU via Formspree (set this in Vercel env)
    const FORMSPREE_OWNER_ENDPOINT = process.env.FORMSPREE_OWNER_ENDPOINT;
    if (!FORMSPREE_OWNER_ENDPOINT) {
      return res.status(500).json({ ok: false, error: "Missing FORMSPREE_OWNER_ENDPOINT in Vercel env vars" });
    }

    const ownerPayload = {
      ...booking,
      cid,
      square_order_id: orderId,
      square_transaction_id: transactionId,
      square_payment_id: paymentId,
      paid_amount: (payment?.amount_money?.amount || 0) / 100,
      paid_currency: payment?.amount_money?.currency || "USD",
      confirmed_at: new Date().toISOString(),
    };

    const mailResp = await fetch(FORMSPREE_OWNER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ownerPayload),
    });

    if (!mailResp.ok) {
      const txt = await mailResp.text().catch(() => "");
      return res.status(502).json({ ok: false, error: "Failed to send owner email", details: txt });
    }

    // 4) Optional: email CUSTOMER via Resend if configured
    let customerEmailSent = false;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const EMAIL_FROM = process.env.EMAIL_FROM; // must be verified in Resend
    const customerEmail = booking?.email || "";

    if (RESEND_API_KEY && EMAIL_FROM && customerEmail) {
      const subject = `MLT Booking Confirmed (#${cid})`;
      const text =
`Your booking is confirmed.

Confirmation #: ${cid}
Route: ${booking.route}
Vehicle: ${booking.vehicle}
Trip: ${booking.trip_type}
Pickup: ${booking.pickup_date} ${booking.pickup_time}
Pickup Location: ${booking.pickup_location}
Destination: ${booking.destination}

If you need any changes, reply to this email or call 407-369-0643.`;

      const rr = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: customerEmail,
          subject,
          text,
        }),
      });

      customerEmailSent = rr.ok;
    }

    return res.status(200).json({ ok: true, confirmationId: cid, customerEmailSent });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Server error", message: err?.message || String(err) });
  }
}
