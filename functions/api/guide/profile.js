import {
  getSession,
  json,
  marketplaceReady,
  methodNotAllowed,
  readJson,
  requireRole,
  sameOriginJson,
  validObject,
} from "../../../lib/marketplace.js";

const PROFILE_FIELDS = ["displayName", "countryCode", "country", "region", "city", "timezone", "bio", "languages", "dailyFee", "currency"];

function currencyFractionDigits(currency) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return null;
  }
}

function validateProfile(payload) {
  if (!validObject(payload, PROFILE_FIELDS)) return "Check the submitted profile fields.";
  const stringFields = [
    ["displayName", 1, 100],
    ["country", 1, 100],
    ["region", 1, 120],
    ["city", 1, 120],
    ["timezone", 1, 80],
    ["bio", 0, 2000],
  ];
  for (const [field, minimum, maximum] of stringFields) {
    if (typeof payload[field] !== "string"
      || payload[field].trim().length < minimum
      || payload[field].trim().length > maximum
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(payload[field])) {
      return `Check the ${field} field.`;
    }
  }
  if (typeof payload.countryCode !== "string" || !/^[a-z]{2}$/i.test(payload.countryCode)) return "Choose a valid two-letter country code.";
  if (!Array.isArray(payload.languages) || payload.languages.length < 1 || payload.languages.length > 20
    || payload.languages.some((language) => typeof language !== "string" || !language.trim() || language.trim().length > 50)) {
    return "Add between 1 and 20 valid guide languages.";
  }
  if (typeof payload.currency !== "string" || !/^[A-Z]{3}$/.test(payload.currency)) return "Choose a valid three-letter currency code.";
  const digits = currencyFractionDigits(payload.currency);
  const fee = Number(payload.dailyFee);
  if (digits === null || !Number.isFinite(fee) || fee <= 0 || fee > 99999999) return "Enter a valid daily guide fee and currency.";
  return null;
}

async function getProfile(env, userId) {
  const row = await env.DB.prepare(`
    SELECT user_id, display_name, country_code, country_name, region, city, timezone,
           bio, languages_json, daily_fee_minor, currency, verification_status,
           public_listing, updated_at
    FROM guide_profiles WHERE user_id = ? LIMIT 1
  `).bind(userId).first();
  if (!row) return null;
  return {
    id: row.user_id,
    displayName: row.display_name,
    countryCode: row.country_code,
    country: row.country_name,
    region: row.region,
    city: row.city,
    timezone: row.timezone,
    bio: row.bio,
    languages: JSON.parse(row.languages_json),
    dailyFeeMinor: row.daily_fee_minor,
    currency: row.currency,
    verificationStatus: row.verification_status,
    publicListing: row.public_listing === 1,
    updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  if (!marketplaceReady(context.env)) return json({ error: "Guide profiles are not available." }, 503);
  const session = await getSession(context);
  if (!requireRole(session, ["guide"])) return json({ error: "Sign in as a guide to access this profile." }, 401);
  try {
    return json({ profile: await getProfile(context.env, session.id) });
  } catch (error) {
    console.error(`Guide profile read failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Guide profile is temporarily unavailable." }, 503);
  }
}

export async function onRequestPut({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Guide profiles are not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!requireRole(session, ["guide"])) return json({ error: "Sign in as a guide to edit this profile." }, 401);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  const validationError = validateProfile(payload);
  if (validationError) return json({ error: validationError }, 400);
  const fractionDigits = currencyFractionDigits(payload.currency);
  const feeMinor = Math.round(Number(payload.dailyFee) * (10 ** fractionDigits));
  if (!Number.isSafeInteger(feeMinor) || feeMinor <= 0) return json({ error: "Enter a valid daily guide fee." }, 400);

  try {
    const result = await env.DB.prepare(`
      INSERT INTO guide_profiles (
        user_id, display_name, country_code, country_name, region, city, timezone,
        bio, languages_json, daily_fee_minor, currency, verification_status, public_listing
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        country_code = excluded.country_code,
        country_name = excluded.country_name,
        region = excluded.region,
        city = excluded.city,
        timezone = excluded.timezone,
        bio = excluded.bio,
        languages_json = excluded.languages_json,
        daily_fee_minor = excluded.daily_fee_minor,
        currency = excluded.currency,
        public_listing = CASE WHEN guide_profiles.verification_status = 'approved' THEN guide_profiles.public_listing ELSE 0 END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `).bind(
      session.id,
      payload.displayName.trim(),
      payload.countryCode.toUpperCase(),
      payload.country.trim(),
      payload.region.trim(),
      payload.city.trim(),
      payload.timezone.trim(),
      payload.bio.trim(),
      JSON.stringify([...new Set(payload.languages.map((language) => language.trim()))]),
      feeMinor,
      payload.currency,
    ).run();
    if (!result.success) throw new Error("guide-profile-save-failed");
    await env.DB.prepare(`
      INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type, details_json)
      VALUES (?, ?, 'guide.profile_updated', ?)
    `).bind(session.id, session.id, JSON.stringify({ countryCode: payload.countryCode.toUpperCase(), currency: payload.currency })).run();
    return json({ profile: await getProfile(env, session.id) });
  } catch (error) {
    console.error(`Guide profile save failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Guide profile could not be saved." }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PUT") return onRequestPut(context);
  return methodNotAllowed("GET, PUT");
}
