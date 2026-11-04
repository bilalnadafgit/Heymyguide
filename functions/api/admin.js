import {
  getSession,
  json,
  marketplaceReady,
  methodNotAllowed,
  readJson,
  requireRole,
  sameOriginJson,
  validObject,
} from "../../lib/marketplace.js";

export async function onRequestGet(context) {
  if (!marketplaceReady(context.env)) return json({ error: "Admin tools are not available." }, 503);
  const session = await getSession(context);
  if (!requireRole(session, ["admin"])) return json({ error: "Admin access is required." }, 401);
  try {
    const [users, guides, bookings, reports, pendingGuides, openReports] = await context.env.DB.batch([
      context.env.DB.prepare("SELECT role, status, COUNT(*) AS count FROM marketplace_users GROUP BY role, status"),
      context.env.DB.prepare("SELECT verification_status, public_listing, COUNT(*) AS count FROM guide_profiles GROUP BY verification_status, public_listing"),
      context.env.DB.prepare("SELECT status, COUNT(*) AS count FROM guide_bookings GROUP BY status"),
      context.env.DB.prepare("SELECT status, COUNT(*) AS count FROM safety_reports GROUP BY status"),
      context.env.DB.prepare(`
        SELECT profile.user_id, profile.display_name, profile.country_name, profile.region,
               profile.city, profile.verification_status, profile.updated_at
        FROM guide_profiles profile
        WHERE profile.verification_status = 'pending'
        ORDER BY profile.updated_at LIMIT 50
      `),
      context.env.DB.prepare(`
        SELECT report.id, report.category, report.status, report.booking_id,
               report.created_at, report.updated_at
        FROM safety_reports report
        WHERE report.status IN ('open', 'reviewing')
        ORDER BY report.created_at LIMIT 50
      `),
    ]);
    return json({
      counts: {
        users: users.results || [],
        guides: guides.results || [],
        bookings: bookings.results || [],
        reports: reports.results || [],
      },
      pendingGuideReviews: pendingGuides.results || [],
      openReports: openReports.results || [],
    });
  } catch (error) {
    console.error(`Admin dashboard read failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Admin overview is temporarily unavailable." }, 503);
  }
}

export async function onRequestPatch({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Admin tools are not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!requireRole(session, ["admin"])) return json({ error: "Admin access is required." }, 401);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }

  if (validObject(payload, ["action", "guideId", "status", "verificationReference", "publicListing"])
    && payload.action === "review_guide"
    && typeof payload.guideId === "string"
    && /^[0-9a-f-]{36}$/i.test(payload.guideId)
    && ["approved", "rejected", "suspended"].includes(payload.status)
    && typeof payload.publicListing === "boolean"
    && (payload.status !== "approved" || (typeof payload.verificationReference === "string" && payload.verificationReference.trim().length >= 3 && payload.verificationReference.trim().length <= 200))) {
    if (env.GUIDE_ID_VERIFICATION_ENABLED !== "true"
      || typeof env.GUIDE_ID_VERIFICATION_PROVIDER !== "string"
      || !env.GUIDE_ID_VERIFICATION_PROVIDER.trim()) {
      return json({ error: "Guide identity-verification provider is not configured." }, 503);
    }
    try {
      const profile = await env.DB.prepare(`
        SELECT profile.user_id, profile.verification_status,
               user.role, user.status AS user_status, user.phone_verified_at
        FROM guide_profiles profile
        JOIN marketplace_users user ON user.id = profile.user_id
        WHERE profile.user_id = ? LIMIT 1
      `).bind(payload.guideId).first();
      if (!profile || profile.role !== "guide") return json({ error: "Guide profile not found." }, 404);
      if (payload.publicListing && (payload.status !== "approved" || profile.user_status !== "active" || !profile.phone_verified_at)) {
        return json({ error: "Only an active, phone-verified, externally reviewed guide can be listed." }, 409);
      }
      const result = await env.DB.prepare(`
        UPDATE guide_profiles
        SET verification_status = ?, verification_provider = ?,
            verification_reference = ?, public_listing = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = ?
        RETURNING user_id
      `).bind(
        payload.status,
        env.GUIDE_ID_VERIFICATION_PROVIDER.trim().slice(0, 100),
        payload.status === "approved" ? payload.verificationReference.trim() : null,
        payload.publicListing ? 1 : 0,
        payload.guideId,
      ).first();
      if (!result) return json({ error: "Guide review could not be saved." }, 409);
      await env.DB.prepare(`
        INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type, details_json)
        VALUES (?, ?, 'admin.guide_reviewed', ?)
      `).bind(session.id, payload.guideId, JSON.stringify({
        status: payload.status,
        publicListing: payload.publicListing,
        provider: env.GUIDE_ID_VERIFICATION_PROVIDER.trim().slice(0, 100),
      })).run();
      return json({ guideId: payload.guideId, verificationStatus: payload.status, publicListing: payload.publicListing });
    } catch (error) {
      console.error(`Guide review failed: ${error instanceof Error ? error.name : "unknown error"}`);
      return json({ error: "Guide review could not be saved." }, 503);
    }
  }

  if (validObject(payload, ["action", "reportId", "status", "resolutionNote"])
    && payload.action === "review_report"
    && typeof payload.reportId === "string"
    && /^[0-9a-f-]{36}$/i.test(payload.reportId)
    && ["reviewing", "resolved", "dismissed"].includes(payload.status)
    && (payload.resolutionNote === undefined
      || (typeof payload.resolutionNote === "string" && payload.resolutionNote.trim().length <= 1000))
    && (payload.status === "reviewing" || (typeof payload.resolutionNote === "string" && payload.resolutionNote.trim().length >= 5))) {
    try {
      const result = await env.DB.prepare(`
        UPDATE safety_reports
        SET status = ?,
            resolution_note = CASE WHEN ? = 'reviewing' THEN NULL ELSE ? END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status IN ('open', 'reviewing')
        RETURNING id, reported_user_id, booking_id
      `).bind(payload.status, payload.status, payload.resolutionNote?.trim() || null, payload.reportId).first();
      if (!result) return json({ error: "Report not found or already closed." }, 404);
      await env.DB.prepare(`
        INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, booking_id, event_type, details_json)
        VALUES (?, ?, ?, 'admin.report_reviewed', ?)
      `).bind(session.id, result.reported_user_id, result.booking_id, JSON.stringify({ reportId: payload.reportId, status: payload.status })).run();
      return json({ reportId: result.id, status: payload.status });
    } catch (error) {
      console.error(`Safety report review failed: ${error instanceof Error ? error.name : "unknown error"}`);
      return json({ error: "Report review could not be saved." }, 503);
    }
  }
  return json({ error: "Check the admin action and required fields." }, 400);
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return methodNotAllowed("GET, PATCH");
}
