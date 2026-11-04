import {
  clearSessionCookie,
  getSession,
  hmac,
  json,
  marketplaceReady,
  methodNotAllowed,
  sameOriginJson,
  SESSION_COOKIE,
} from "../../../lib/marketplace.js";

function sessionToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === SESSION_COOKIE) return part.slice(separator + 1).trim();
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Marketplace sign-in is not configured." }, 503, { "Set-Cookie": clearSessionCookie() });
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  const token = sessionToken(request);
  if (session && token) {
    const tokenHash = await hmac(env.SESSION_HMAC_SECRET, token);
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at = unixepoch() WHERE id_hash = ? AND revoked_at IS NULL").bind(tokenHash).run();
    await env.DB.prepare(`
      INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type)
      VALUES (?, ?, 'auth.sign_out')
    `).bind(session.id, session.id).run();
  }
  return json({ signedOut: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
}
