import {
  getSession,
  json,
  marketplaceReady,
  methodNotAllowed,
  readJson,
  requireRole,
  sameOriginJson,
  validObject,
  uuid,
} from "../../lib/marketplace.js";

const MAX_HORIZON_MS = 1000 * 60 * 60 * 24 * 365;
const MIN_LEAD_MS = 1000 * 60 * 30;
const MAX_SLOT_MS = 1000 * 60 * 60 * 24;

function validDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export async function onRequestGet(context) {
  if (!marketplaceReady(context.env)) return json({ error: "Availability is not available." }, 503);
  const session = await getSession(context);
  if (!requireRole(session, ["guide"])) return json({ error: "Sign in as a guide to view your availability." }, 401);
  try {
    await context.env.DB.prepare(`
      UPDATE guide_bookings
      SET status = 'cancelled', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE guide_user_id = ? AND status = 'requested'
        AND availability_id IN (
          SELECT id FROM guide_availability
          WHERE status = 'booked' AND hold_expires_at IS NOT NULL AND hold_expires_at <= unixepoch()
        )
    `).bind(session.id).run();
    await context.env.DB.prepare(`
      UPDATE guide_availability SET status = 'open', hold_expires_at = NULL
      WHERE guide_user_id = ? AND status = 'held' AND hold_expires_at <= unixepoch()
    `).bind(session.id).run();
    const result = await context.env.DB.prepare(`
      SELECT id, starts_at AS startsAt, ends_at AS endsAt, status, hold_expires_at AS holdExpiresAt
      FROM guide_availability
      WHERE guide_user_id = ? AND starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ORDER BY starts_at LIMIT 100
    `).bind(session.id).all();
    return json({ availability: result.results || [] });
  } catch (error) {
    console.error(`Availability read failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Availability is temporarily unavailable." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Availability is not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!requireRole(session, ["guide"])) return json({ error: "Sign in as a guide to add availability." }, 401);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validObject(payload, ["startsAt", "endsAt"]) || !validDate(payload.startsAt) || !validDate(payload.endsAt)) {
    return json({ error: "Provide start and end times with an explicit time zone." }, 400);
  }
  const start = Date.parse(payload.startsAt);
  const end = Date.parse(payload.endsAt);
  const now = Date.now();
  if (start < now + MIN_LEAD_MS || start > now + MAX_HORIZON_MS || end <= start || end - start > MAX_SLOT_MS) {
    return json({ error: "Choose a future slot, at least 30 minutes from now and no longer than 24 hours." }, 400);
  }
  try {
    const id = uuid();
    const result = await env.DB.prepare(`
      INSERT INTO guide_availability (id, guide_user_id, starts_at, ends_at, status)
      SELECT ?, ?, ?, ?, 'open'
      WHERE EXISTS (
        SELECT 1 FROM guide_profiles profile
        JOIN marketplace_users user ON user.id = profile.user_id
        WHERE profile.user_id = ?
          AND profile.verification_status = 'approved'
          AND user.status = 'active'
          AND user.phone_verified_at IS NOT NULL
      )
    `).bind(id, session.id, new Date(start).toISOString(), new Date(end).toISOString(), session.id).run();
    if (!result.success) throw new Error("availability-insert-failed");
    if (result.meta?.changes !== 1) return json({ error: "Only an active, phone-verified, approved guide can publish slots." }, 403);
    await env.DB.prepare(`
      INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type, details_json)
      VALUES (?, ?, 'guide.availability_created', ?)
    `).bind(session.id, session.id, JSON.stringify({ availabilityId: id })).run();
    return json({ availability: { id, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), status: "open" } }, 201);
  } catch (error) {
    const overlapping = error instanceof Error && error.message.includes("overlaps");
    if (overlapping) return json({ error: "This slot overlaps another offered or booked slot." }, 409);
    console.error(`Availability create failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Availability could not be saved." }, 503);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Availability is not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!requireRole(session, ["guide"])) return json({ error: "Sign in as a guide to remove availability." }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Choose a valid availability slot." }, 400);
  try {
    const result = await env.DB.prepare(`
      UPDATE guide_availability SET status = 'blocked'
      WHERE id = ? AND guide_user_id = ? AND status = 'open'
      RETURNING id
    `).bind(id, session.id).first();
    if (!result) return json({ error: "That slot is not available to remove; it may already be held or booked." }, 409);
    await env.DB.prepare(`
      INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type, details_json)
      VALUES (?, ?, 'guide.availability_removed', ?)
    `).bind(session.id, session.id, JSON.stringify({ availabilityId: id })).run();
    return json({ removed: true });
  } catch (error) {
    console.error(`Availability removal failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Availability could not be removed." }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed("GET, POST, DELETE");
}
