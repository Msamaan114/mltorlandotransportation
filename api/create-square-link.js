// /api/create-square-link.js

import crypto from "crypto";

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  // Health check
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "create-square-link is working" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Vercel can give req.body as an object OR a string
    const bodyIn = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { amountCents, route, vehicle, tripType } = bodyIn;

    const amount = Number(amountCents);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "amountCents is required and must be a positive number" });
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

    // Use env var to pick sandbox vs production
    // Set SQUARE_ENV=sandbox (default) or production
    const squareEnv = (process.env.SQUARE_ENV || "sandbox").toLowerCase();
    const baseUrl =
      squareEnv === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    // Idempotency key
    const idem =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const lineItemName =
      [
        route ? `Route: ${route}` : null,
        vehicle ? `Vehicle: ${vehicle}` : null,
        tripType ? `Trip: ${tripType}` : null,
      ]
        .filter(Boolean)
        .join(" | ") || "MLT Orlando Transportation";

    const payload = {
      idempotency_key: idem,
      order: {
        location_id: locationId,
        line_items: [
          {
            name: lineItemName,
            quantity: "1",
            base_price_money: {
              amount: Math.round(amount),
              currency: "USD",
            },
          },
        ],
      },
      checkout_options: {
        // Use your real domain (and ideally a real thank-you page)
        redirect_url: "https://www.mltorlandotransportation.com/booking.html?paid=1",
      },
    };

    const resp = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // If Square-Version ever causes trouble, keep it OFF (Square will default).
        // "Square-Version": "2024-12-18",
      },
      body: JSON.stringify(payload),
    });

    // Don’t assume JSON (avoids serverless crash → 502)
    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: "Square API error",
        details: data,
      });
    }

    const url = data?.payment_link?.url;
    if (!url) {
      return res.status(500).json({
        ok: false,
        error: "No payment_link.url returned from Square",
        details: data,
      });
    }

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
