import { json, marketplaceReady, methodNotAllowed } from "../../lib/marketplace.js";

function readLocation(url, name, maximum) {
  const value = url.searchParams.get(name)?.trim() || "";
  return value.length <= maximum ? value : null;
}

export async function onRequestGet({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Guide discovery is not available." }, 503);
  const url = new URL(request.url);
  const countryCode = readLocation(url, "country", 2);
  const region = readLocation(url, "region", 120);
  const city = readLocation(url, "city", 120);
  const limitText = url.searchParams.get("limit") || "20";
  const limit = Number(limitText);
  if (countryCode === null || region === null || city === null
    || (countryCode && !/^[a-z]{2}$/i.test(countryCode))
    || !/^\d+$/.test(limitText)
    || !Number.isInteger(limit)
    || limit < 1
    || limit > 50) {
    return json({ error: "Check the location filters and result limit." }, 400);
  }
  try {
    const result = await env.DB.prepare(`
      SELECT profile.user_id AS id, profile.display_name, profile.country_code,
             profile.country_name, profile.region, profile.city, profile.timezone,
             profile.bio, profile.languages_json, profile.daily_fee_minor,
             profile.currency, profile.updated_at,
             (SELECT json_group_array(json_object(
               'id', slot.id,
               'startsAt', slot.starts_at,
               'endsAt', slot.ends_at
             ))
             FROM (
               SELECT id, starts_at, ends_at
               FROM guide_availability
               WHERE guide_user_id = profile.user_id
                 AND status = 'open'
                 AND starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               ORDER BY starts_at LIMIT 50
             ) slot) AS availability_json,
             (SELECT json_group_array(json_object(
               'id', experience.id,
               'title', experience.title,
               'description', experience.description,
               'durationMinutes', experience.duration_minutes
             ))
             FROM guide_experiences experience
             WHERE experience.guide_user_id = profile.user_id AND experience.active = 1) AS experiences_json
      FROM guide_profiles profile
      JOIN marketplace_users user ON user.id = profile.user_id
      WHERE profile.public_listing = 1
        AND profile.verification_status = 'approved'
        AND user.role = 'guide'
        AND user.status = 'active'
        AND user.phone_verified_at IS NOT NULL
        AND (? = '' OR profile.country_code = ?)
        AND (? = '' OR profile.region = ?)
        AND (? = '' OR profile.city = ?)
      ORDER BY profile.city COLLATE NOCASE, profile.updated_at DESC, profile.user_id
      LIMIT ?
    `).bind(
      countryCode.toUpperCase(), countryCode.toUpperCase(),
      region, region,
      city, city,
      limit,
    ).all();
    const guides = (result.results || []).map((guide) => ({
      id: guide.id,
      displayName: guide.display_name,
      countryCode: guide.country_code,
      country: guide.country_name,
      region: guide.region,
      city: guide.city,
      timezone: guide.timezone,
      bio: guide.bio,
      languages: JSON.parse(guide.languages_json),
      dailyFeeMinor: guide.daily_fee_minor,
      currency: guide.currency,
      availability: JSON.parse(guide.availability_json || "[]"),
      experiences: JSON.parse(guide.experiences_json || "[]"),
    }));
    return json({ guides });
  } catch (error) {
    console.error(`Guide discovery failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Guide discovery is temporarily unavailable." }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed("GET");
}
