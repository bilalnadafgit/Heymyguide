import {
  consumeRateLimit,
  getSession,
  json,
  marketplaceReady,
  methodNotAllowed,
  readJson,
  sameOriginJson,
  validObject,
  uuid,
} from "../../lib/marketplace.js";

export async function onRequestPost({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Safety reporting is not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!session || !["traveler", "guide"].includes(session.role)) return json({ error: "Sign in to report a safety or booking issue." }, 401);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validObject(payload, ["bookingId", "category", "description"])
    || typeof payload.bookingId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(payload.bookingId)
    || !["safety", "misconduct", "payment", "no_show", "other"].includes(payload.category)
    || typeof payload.description !== "string"
    || payload.description.trim().length < 10
    || payload.description.trim().length > 3000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(payload.description)) {
    return json({ error: "Choose a report category and provide a 10–3000 character description." }, 400);
  }
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 64) return json({ error: "Reporting is temporarily unavailable." }, 503);
  try {
    if (!(await consumeRateLimit(env.DB, env.AUTH_HMAC_SECRET, `report:${session.id}:${ip}`, 5, 3600))) {
      return json({ error: "Too many reports. Contact support if someone is in immediate danger." }, 429, { "Retry-After": "3600" });
    }
    const booking = await env.DB.prepare(`
      SELECT id, traveler_user_id, guide_user_id FROM guide_bookings
      WHERE id = ? AND (traveler_user_id = ? OR guide_user_id = ?)
      LIMIT 1
    `).bind(payload.bookingId, session.id, session.id).first();
    if (!booking) return json({ error: "A report must be connected to one of your bookings." }, 404);
    const reportedUserId = booking.traveler_user_id === session.id ? booking.guide_user_id : booking.traveler_user_id;
    const reportId = uuid();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO safety_reports (
          id, reporter_user_id, reported_user_id, booking_id, category, description
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(reportId, session.id, reportedUserId, booking.id, payload.category, payload.description.trim()),
      env.DB.prepare(`
        INSERT INTO marketplace_audit_events (
          actor_user_id, subject_user_id, booking_id, event_type, details_json
        ) VALUES (?, ?, ?, 'safety.report_created', ?)
      `).bind(session.id, reportedUserId, booking.id, JSON.stringify({ reportId, category: payload.category })),
    ]);
    return json({ reportId, status: "open", message: "Your report was sent to the heymyGuide review queue. This is not an emergency service." }, 201);
  } catch (error) {
    console.error(`Safety report create failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Your report could not be submitted. Contact support if the matter is urgent." }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
}
