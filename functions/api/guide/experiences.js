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
} from "../../../lib/marketplace.js";

function validExperience(payload, fields) {
  if (!validObject(payload, fields)) return false;
  return typeof payload.title === "string"
      && payload.title.trim().length >= 3
      && payload.title.trim().length <= 120
      && typeof payload.description === "string"
      && payload.description.trim().length >= 1
      && payload.description.trim().length <= 3000
      && Number.isInteger(payload.durationMinutes)
      && payload.durationMinutes >= 30
      && payload.durationMinutes <= 1440;
}

export async function onRequestGet(context) {
  if (!marketplaceReady(context.env)) return json({ error: "Guide experiences are not available." }, 503);
  const session = await getSession(context);
  if (!requireRole(session, ["guide"])) return json({ error: "Sign in as a guide to manage experiences." }, 401);
  try {
    const result = await context.env.DB.prepare(`
      SELECT id, title, description, duration_minutes AS durationMinutes, active, created_at AS createdAt
      FROM guide_experiences WHERE guide_user_id = ? ORDER BY created_at DESC LIMIT 100
    `).bind(session.id).all();
    return json({ experiences: result.results || [] });
  } catch (error) {
    console.error(`Guide experience read failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Guide experiences are temporarily unavailable." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Guide experiences are not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!requireRole(session, ["guide"])) return json({ error: "Sign in as a guide to manage experiences." }, 401);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validExperience(payload, ["title", "description", "durationMinutes"])) {
    return json({ error: "Add a title, description and duration between 30 minutes and 24 hours." }, 400);
  }
  try {
    const id = uuid();
    const result = await env.DB.prepare(`
      INSERT INTO guide_experiences (id, guide_user_id, title, description, duration_minutes)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, session.id, payload.title.trim(), payload.description.trim(), payload.durationMinutes).run();
    if (!result.success) throw new Error("experience-insert-failed");
    await env.DB.prepare(`
      INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type, details_json)
      VALUES (?, ?, 'guide.experience_created', ?)
    `).bind(session.id, session.id, JSON.stringify({ experienceId: id })).run();
    return json({ experience: { id, title: payload.title.trim(), description: payload.description.trim(), durationMinutes: payload.durationMinutes, active: 1 } }, 201);
  } catch (error) {
    console.error(`Guide experience create failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Guide experience could not be saved." }, 503);
  }
}

export async function onRequestPatch({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Guide experiences are not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!requireRole(session, ["guide"])) return json({ error: "Sign in as a guide to manage experiences." }, 401);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validExperience(payload, ["id", "title", "description", "durationMinutes", "active"])
    || typeof payload.id !== "string"
    || !/^[0-9a-f-]{36}$/i.test(payload.id)
    || typeof payload.active !== "boolean") {
    return json({ error: "Check the experience details." }, 400);
  }
  try {
    const result = await env.DB.prepare(`
      UPDATE guide_experiences
      SET title = ?, description = ?, duration_minutes = ?, active = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND guide_user_id = ?
      RETURNING id
    `).bind(payload.title.trim(), payload.description.trim(), payload.durationMinutes, payload.active ? 1 : 0, payload.id, session.id).first();
    if (!result) return json({ error: "Experience not found." }, 404);
    await env.DB.prepare(`
      INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type, details_json)
      VALUES (?, ?, 'guide.experience_updated', ?)
    `).bind(session.id, session.id, JSON.stringify({ experienceId: payload.id, active: payload.active })).run();
    return json({ updated: true });
  } catch (error) {
    console.error(`Guide experience update failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Guide experience could not be updated." }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return methodNotAllowed("GET, POST, PATCH");
}
