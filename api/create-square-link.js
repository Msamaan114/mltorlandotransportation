// api/create-square-link.js
const crypto = require("crypto");

// Server-side price table (source of truth).
// IMPORTANT: This prevents people from changing ?price= in the URL and paying less.
const PRICES = {
  MCO_UNIVERSAL: {
    SEDAN: { ONEWAY: 110, ROUND: 210 },
    SUV: { ONEWAY: 120, ROUND: 230 },
    VAN8: { ONEWAY: 140, ROUND: 260 },
    VAN14: { ONEWAY: 170, ROUND: 310 },
  },
  MCO_DISNEY: {
    SEDAN: { ONEWAY: 120, ROUND: 220 },
    SUV: { ONEWAY: 130, ROUND: 240 },
    VAN8: { ONEWAY: 150, ROUND: 280 },
    VAN14: { ONEWAY: 180, ROUND: 330 },
  },
  MCO_WINDERMERE: {
    SEDAN: { ONEWAY: 130, ROUND: 240 },
    SUV: { ONEWAY: 140, ROUND: 260 },
    VAN8: { ONEWAY: 160, ROUND: 300 },
    VAN14: { ONEWAY: 190, ROUND: 340 },
  },
  MCO_PORT: {
    SEDAN: { ONEWAY: 210, ROUND: 400 },
    SUV: { ONEWAY: 230, ROUND: 440 },
    VAN8: { ONEWAY: 260, ROUND: 500 },
    VAN14: { ONEWAY: 290, ROUND: 560 },
  },
  SFB_IDRIVE: {
    SEDAN: { ONEWAY: 160, ROUND: 300 },
    SUV: { ONEWAY: 175, ROUND: 330 },
    VAN8: { ONEWAY: 200, ROUND: 380 },
    VAN14: { ONEWAY: 225, ROUND: 420 },
  },
  SFB_DISNEY: {
    SEDAN: { ONEWAY: 175, ROUND: 330 },
    SUV: { ONEWAY: 190, ROUND: 360 },
    VAN8: { ONEWAY: 220, ROUND: 420 },
    VAN14: { ONEWAY: 245, ROUND: 470 },
  },
  HOURLY: {
    // hourly is per-hour rate
    SEDAN: { HOURLY: 70 },
    SUV: { HOURLY: 85 },
    VAN8: { HOURLY: 95 },
    VAN14: { HOURLY: 120 },
  },
};

// Optional: for nicer labels in Square checkout item name
const ROUTE_LABEL = {
  MCO_UNIVERSAL: "MCO ↔ Universal / I-Drive / SeaWorld / Convention Center",
  MCO_DISNEY: "MCO ↔ Disney / Lake Buena Vista / Bay Lake / Golden Oak",
  MCO_WINDERMERE: "MCO ↔ Windermere / Winter Park",
  MCO_PORT: "MCO / Orlando ↔ Port Canaveral",
  SFB_IDRIVE: "SFB ↔ I-Drive / Convention / Universal / SeaWorld",
  SFB_DISNEY: "SFB ↔ Disney / Lake Buena Vista / Bay Lake / Golden Oak",
  HOURLY: "Hourly Charter (within Orlando)",
};

const VEHICLE_LABEL = {
  SEDAN: "Sedan",
  SUV: "SUV",
  VAN8: "8-passenger van",
  VAN14: "14-passenger van",
};

const TRIP_LABEL = {
  ONEWAY: "One-way",
  ROUND: "Round trip",
  HOURLY: "Hourly",
};

function getBaseUrl() {
  const env = (process.env.SQUARE_ENV || "production").toLowerCase();
  // Square docs: production uses connect.squareup.com, sandbox uses connect.squareupsandbox.com :contentReference[oaicite:3]{index=3}
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com/v2"
    : "https://connect.squareup.com/v2";
}

function bad(res, msg, code = 400) {
  res.status(code).json({ error: msg });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return bad(res, "Use POST", 405);

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;

  if (!token) return bad(res, "Missing SQUARE_ACCESS_TOKEN env var", 500);
  if (!locationId) return bad(res, "Missing SQUARE_LOCATION_ID env var", 500);

  let body = req.body;
  // Vercel sometimes gives body as a string depending on config
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) {}
  }

  const route = String(body?.route || "");
  const vehicle = String(body?.vehicle || "");
  const tripType = String(body?.tripType || "");
  const hoursRaw = body?.hours;

  if (!route || !vehicle || !tripType) {
    return bad(res, "route, vehicle, tripType are required");
  }

  // Reject custom routes (no fixed price)
  if (route === "CUSTOM") {
    return bad(res, "Custom routes do not have an automatic payment link");
  }

  // Server-side price lookup
  const routeData = PRICES[route];
  const vehicleData = routeData?.[vehicle];
  const unit = vehicleData?.[tripType];

  if (route === "HOURLY" && tripType === "HOURLY") {
    const rate = unit;
    if (typeof rate !== "number") return bad(res, "Invalid hourly combination");

    let hours = parseInt(String(hoursRaw ?? "3"), 10);
    if (Number.isNaN(hours)) hours = 3;
    if (hours < 3) hours = 3;
    if (hours > 24) hours = 24;

    const total = rate * hours;

    return await createLink({
      res,
      token,
      locationId,
      amountUsd: total,
      itemName: `MLT Orlando Transportation – ${ROUTE_LABEL[route] || route} – ${VEHICLE_LABEL[vehicle] || vehicle} – ${hours} hours`,
      note: `Route=${route}, Vehicle=${vehicle}, Trip=${tripType}, Hours=${hours}`,
    });
  }

  if (typeof unit !== "number") return bad(res, "Invalid route/vehicle/tripType combination");

  return await createLink({
    res,
    token,
    locationId,
    amountUsd: unit,
    itemName: `MLT Orlando Transportation – ${ROUTE_LABEL[route] || route} – ${VEHICLE_LABEL[vehicle] || vehicle} – ${TRIP_LABEL[tripType] || tripType}`,
    note: `Route=${route}, Vehicle=${vehicle}, Trip=${tripType}`,
  });
};

async function createLink({ res, token, locationId, amountUsd, itemName, note }) {
  const baseUrl = getBaseUrl();
  const amountCents = Math.round(Number(amountUsd) * 100);

  // Square CreatePaymentLink expects amount as an integer (in cents) inside price_money, plus location_id :contentReference[oaicite:4]{index=4}
  const payload = {
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name: itemName,
      price_money: { amount: amountCents, currency: "USD" },
      location_id: locationId,
    },
    payment_note: note,
  };

  // Square-Version header is required; docs show current version like 2025-10-16 :contentReference[oaicite:5]{index=5}
  const squareVersion = process.env.SQUARE_VERSION || "2025-10-16";

  const r = await fetch(`${baseUrl}/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      "Square-Version": squareVersion,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    return res.status(502).json({
      error: "Square error creating payment link",
      status: r.status,
      details: data,
    });
  }

  // Square returns payment_link.url / payment_link.long_url :contentReference[oaicite:6]{index=6}
  return res.status(200).json({
    url: data?.payment_link?.url,
    long_url: data?.payment_link?.long_url,
    id: data?.payment_link?.id,
  });
}
