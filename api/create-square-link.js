// /api/create-square-link.js
const { Client, Environment } = require("square");
const crypto = require("crypto");

function mustString(x) { return typeof x === "string" ? x.trim() : ""; }

module.exports = async function handler(req, res) {
  // CORS (adjust if needed)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();
    const squareEnv = env === "sandbox" ? Environment.Sandbox : Environment.Production;

    const client = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: squareEnv,
    });

    const body = req.body || {};
    const bookingId = mustString(body.bookingId) || crypto.randomUUID();

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const locationId = process.env.SQUARE_LOCATION_ID;
    if (!locationId) {
      return res.status(500).json({ ok: false, error: "Missing SQUARE_LOCATION_ID" });
    }

    // IMPORTANT: Use your real public domain here (must be HTTPS)
    // Square will append &orderId=...&transactionId=... in production. :contentReference[oaicite:3]{index=3}
    const redirectUrl = `${process.env.PUBLIC_BASE_URL || "https://www.mltorlandotransportation.com"}/confirmation.html?bookingId=${encodeURIComponent(bookingId)}`;

    const route = mustString(body.route);
    const vehicle = mustString(body.vehicle);
    const trip = mustString(body.trip);

    const passengerName = mustString(body.passengerName);
    const email = mustString(body.email);
    const pickupDate = mustString(body.pickupDate);
    const pickupTime = mustString(body.pickupTime);

    const note = [
      `BookingId: ${bookingId}`,
      `Name: ${passengerName}`,
      `Email: ${email}`,
      `Phone: ${mustString(body.phone)}`,
      `Route: ${route}`,
      `Vehicle: ${vehicle}`,
      `Trip: ${trip}`,
      `Pickup: ${pickupDate} ${pickupTime}`,
      `Pickup location: ${mustString(body.pickupLocation)}`,
      `Destination: ${mustString(body.destination)}`,
      `Flight: ${mustString(body.flight)}`,
      `Passengers: ${mustString(body.passengers)}`,
      `Luggage: ${mustString(body.luggage)}`,
      `Child seats: ${mustString(body.childSeats)}`,
      `Notes: ${mustString(body.notes)}`
    ].join(" | ");

    const cents = Math.round(amount * 100);

    const createBody = {
      idempotencyKey: crypto.randomUUID(),
      order: {
        locationId,
        referenceId: bookingId, // useful to match later
        lineItems: [
          {
            name: "Transportation Booking",
            quantity: "1",
            basePriceMoney: { amount: cents, currency: "USD" }
          }
        ],
        note
      },
      checkoutOptions: {
        redirectUrl
      }
    };

    // Some SDK versions expect snake_case ("checkout_options"). To be resilient, try camelCase first, then fallback.
    let result;
    try {
      const resp = await client.checkoutApi.createPaymentLink(createBody);
      result = resp.result || resp;
    } catch (e) {
      const fallbackBody = {
        idempotency_key: createBody.idempotencyKey,
        order: {
          location_id: locationId,
          reference_id: bookingId,
          line_items: [
            {
              name: "Transportation Booking",
              quantity: "1",
              base_price_money: { amount: cents, currency: "USD" }
            }
          ],
          note
        },
        checkout_options: { redirect_url: redirectUrl }
      };
      const resp2 = await client.checkoutApi.createPaymentLink(fallbackBody);
      result = resp2.result || resp2;
    }

    const pl =
      result.paymentLink ||
      result.payment_link ||
      result.paymentlink ||
      null;

    const url = (pl && (pl.url || pl.longUrl || pl.long_url)) || result.url || result.long_url;

    if (!url) {
      return res.status(500).json({ ok: false, error: "No payment link URL returned" });
    }

    return res.status(200).json({ ok: true, url, bookingId });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Square error" });
  }
};
