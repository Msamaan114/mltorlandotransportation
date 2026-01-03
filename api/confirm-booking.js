// /api/confirm-booking.js
const { Client, Environment } = require("square");
const sgMail = require("@sendgrid/mail");

function esc(s) {
  return String(s || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const {
      bookingId = "",
      orderId = "",
      transactionId = "", // may be present; we primarily verify via orderId
      booking = null
    } = req.body || {};

    if (!orderId) {
      // In sandbox, Square sometimes doesn't append orderId/transactionId. :contentReference[oaicite:7]{index=7}
      return res.status(400).json({ ok: false, error: "Missing orderId from Square redirect" });
    }

    const env = (process.env.SQUARE_ENV || "production").toLowerCase();
    const squareEnv = env === "sandbox" ? Environment.Sandbox : Environment.Production;

    const client = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: squareEnv,
    });

    // 1) Retrieve Order
    const orderResp = await client.ordersApi.retrieveOrder(orderId);
    const orderResult = orderResp.result || orderResp;
    const order = orderResult.order;

    const tenders = order?.tenders || [];
    const paymentId =
      tenders[0]?.paymentId ||
      tenders[0]?.payment_id ||
      null;

    if (!paymentId) {
      return res.status(400).json({ ok: false, error: "Order not paid yet (no paymentId found)" });
    }

    // 2) Retrieve Payment
    const payResp = await client.paymentsApi.getPayment(paymentId);
    const payResult = payResp.result || payResp;
    const payment = payResult.payment;

    const status = payment?.status;
    if (status !== "COMPLETED") {
      return res.status(400).json({ ok: false, error: `Payment not completed (status: ${status})` });
    }

    // 3) Send Emails (SendGrid)
    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    const EMAIL_FROM = process.env.EMAIL_FROM; // e.g. bookings@mltorlandotransportation.com
    const EMAIL_TO_OWNER = process.env.EMAIL_TO_OWNER || "mltorlando@yahoo.com";

    if (!SENDGRID_API_KEY || !EMAIL_FROM) {
      return res.status(500).json({ ok: false, error: "Missing SENDGRID_API_KEY or EMAIL_FROM" });
    }

    sgMail.setApiKey(SENDGRID_API_KEY);

    const confirmationNumber = (bookingId || order?.referenceId || order?.reference_id || orderId).slice(0, 8).toUpperCase();

    const customerEmail = booking?.email || "";
    const customerName = booking?.passengerName || "";

    const summaryLines = [
      `Confirmation: ${confirmationNumber}`,
      `OrderId: ${orderId}`,
      `PaymentId: ${paymentId}`,
      `Amount: ${(payment?.amountMoney?.amount ?? payment?.amount_money?.amount ?? 0) / 100} ${(payment?.amountMoney?.currency ?? payment?.amount_money?.currency ?? "USD")}`,
      "",
      "BOOKING DETAILS",
      `Passenger: ${booking?.passengerName || ""}`,
      `Email: ${booking?.email || ""}`,
      `Phone: ${booking?.phone || ""}`,
      `Passengers: ${booking?.passengers || ""}`,
      `Pickup: ${booking?.pickupDate || ""} ${booking?.pickupTime || ""}`,
      `Pickup location: ${booking?.pickupLocation || ""}`,
      `Destination: ${booking?.destination || ""}`,
      `Route: ${booking?.route || ""}`,
      `Vehicle: ${booking?.vehicle || ""}`,
      `Trip type: ${booking?.trip || ""}`,
      `Flight: ${booking?.flight || ""}`,
      `Luggage: ${booking?.luggage || ""}`,
      `Child seats: ${booking?.childSeats || ""}`,
      `Notes: ${booking?.notes || ""}`,
    ].join("\n");

    // Customer email
    if (customerEmail) {
      await sgMail.send({
        to: customerEmail,
        from: EMAIL_FROM,
        subject: `MLT Booking Confirmed — ${confirmationNumber}`,
        text:
`Your booking is confirmed.

Confirmation: ${confirmationNumber}

Pickup: ${booking?.pickupDate || ""} ${booking?.pickupTime || ""}
From: ${booking?.pickupLocation || ""}
To: ${booking?.destination || ""}

If you need changes, reply to this email or contact us at 407-369-0643.

Thank you,
MLT Orlando Transportation`,
        html:
`<p>Your booking is <strong>confirmed</strong>.</p>
<p><strong>Confirmation:</strong> ${esc(confirmationNumber)}</p>
<p><strong>Pickup:</strong> ${esc(booking?.pickupDate)} ${esc(booking?.pickupTime)}<br/>
<strong>From:</strong> ${esc(booking?.pickupLocation)}<br/>
<strong>To:</strong> ${esc(booking?.destination)}</p>
<p>If you need changes, reply to this email or contact us at <strong>407-369-0643</strong>.</p>
<p>Thank you,<br/>MLT Orlando Transportation</p>`
      });
    }

    // Owner email
    await sgMail.send({
      to: EMAIL_TO_OWNER,
      from: EMAIL_FROM,
      subject: `NEW PAID BOOKING — ${confirmationNumber}`,
      text: summaryLines,
      html: `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;">${esc(summaryLines)}</pre>`
    });

    return res.status(200).json({
      ok: true,
      confirmationNumber,
      customerEmail,
      orderId,
      paymentId
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Confirmation error" });
  }
};
