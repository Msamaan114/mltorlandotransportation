export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const { orderId, cid = "", bookingData = null } = req.body || {};
    if (!orderId) return res.status(400).json({ ok: false, error: "Missing orderId" });

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
      // Sometimes payment_id may not be immediately available; let the user refresh.
      return res.status(200).json({ ok: false, error: "Payment not attached yet", status: "PENDING", order });
    }

    // 2) Retrieve payment
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
      return res.status(200).json({ ok: false, error: "Payment not completed", status: payment?.status || "UNKNOWN" });
    }

    // 3) Send emails (Resend)
    // Set in Vercel:
    // RESEND_API_KEY, EMAIL_FROM (verified), EMAIL_TO (your inbox)
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const EMAIL_FROM = process.env.EMAIL_FROM; // e.g. "MLT Orlando <[email protected]>"
    const EMAIL_TO = process.env.EMAIL_TO;     // e.g. "[email protected]"

    const customerEmail = bookingData?.email || "";
    const subject = `MLT Booking Confirmed ${cid ? `(#${cid})` : ""}`;

    const detailsText = [
      `Confirmation: ${cid || "(n/a)"}`,
      `OrderId: ${orderId}`,
      `Amount: $${(payment?.amount_money?.amount || 0) / 100} ${payment?.amount_money?.currency || "USD"}`,
      "",
      "Booking details:",
      bookingData ? JSON.stringify(bookingData, null, 2) : "(No bookingData saved on device)",
      "",
      "Square order note:",
      order?.note || "(none)",
    ].join("\n");

    async function sendEmail(to, htmlTitle) {
      if (!RESEND_API_KEY || !EMAIL_FROM || !to) return;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to,
          subject,
          text: detailsText,
          html: `<h2>${htmlTitle}</h2><pre>${escapeHtml(detailsText)}</pre>`,
        }),
      });
    }

    function escapeHtml(str) {
      return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    // email you
    await sendEmail(EMAIL_TO, "New booking confirmed");
    // email customer
    await sendEmail(customerEmail, "Your booking is confirmed");

    return res.status(200).json({ ok: true, confirmationId: cid || "" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Server error", message: err?.message || String(err) });
  }
}
