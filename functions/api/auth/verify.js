import {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  consumeRateLimit,
  createSession,
  hmac,
  json,
  marketplaceReady,
  methodNotAllowed,
  readJson,
  sameOriginJson,
  secureEqual,
  sessionCookie,
  validObject,
} from "../../../lib/marketplace.js";

export async function onRequestPost({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Marketplace sign-in is not configured." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validObject(payload, ["challengeId", "code"])
    || typeof payload.challengeId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(payload.challengeId)
    || typeof payload.code !== "string"
    || !/^\d{6}$/.test(payload.code)) {
    return json({ error: "Enter the six-digit code and try again." }, 400);
  }
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 64) return json({ error: "Sign-in is temporarily unavailable." }, 503);
  try {
    if (!(await consumeRateLimit(env.DB, env.AUTH_HMAC_SECRET, `verify-ip:${ip}`, 20, 900))) {
      return json({ error: "Too many verification attempts. Please wait and try again." }, 429, { "Retry-After": "900" });
    }
    const challenge = await env.DB.prepare(`
      SELECT id, subject_hash, purpose, role, channel, contact_value, code_hash,
             expires_at, attempts, consumed_at
      FROM auth_challenges
      WHERE id = ?
      LIMIT 1
    `).bind(payload.challengeId).first();
    if (!challenge || challenge.consumed_at !== null || challenge.expires_at <= Math.floor(Date.now() / 1000) || challenge.attempts >= 5) {
      return json({ error: "The code is invalid or expired. Request a new code." }, 400);
    }
    const nextAttempt = await env.DB.prepare(`
      UPDATE auth_challenges SET attempts = attempts + 1
      WHERE id = ? AND consumed_at IS NULL AND expires_at > unixepoch() AND attempts < 5
      RETURNING attempts
    `).bind(challenge.id).first();
    if (!nextAttempt) return json({ error: "The code is invalid or expired. Request a new code." }, 400);

    const suppliedHash = await hmac(env.AUTH_HMAC_SECRET, `${challenge.id}:${payload.code}`);
    if (!secureEqual(suppliedHash, challenge.code_hash)) {
      return json({ error: "The code is invalid or expired. Request a new code." }, 400);
    }

    const contact = challenge.contact_value;
    const contactIsValid = challenge.channel === "email"
      ? EMAIL_PATTERN.test(contact) && contact === contact.toLowerCase()
      : PHONE_PATTERN.test(contact);
    if (!contactIsValid) return json({ error: "Sign-in is temporarily unavailable." }, 503);

    if (challenge.role === "admin") {
      const ownerEmail = typeof env.ADMIN_OWNER_EMAIL === "string" ? env.ADMIN_OWNER_EMAIL.trim().toLowerCase() : "";
      if (challenge.channel !== "email" || contact !== ownerEmail) return json({ error: "Admin sign-in is unavailable." }, 403);
      const adminCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM marketplace_users WHERE role = 'admin' AND status = 'active'").first("count");
      if (challenge.purpose === "admin_bootstrap" && (env.ADMIN_BOOTSTRAP_ENABLED !== "true" || adminCount !== 0)) {
        return json({ error: "Secure admin setup is unavailable or already completed." }, 403);
      }
      if (challenge.purpose !== "admin_bootstrap" && adminCount === 0) {
        return json({ error: "Secure admin setup is unavailable." }, 403);
      }
    }

    const column = challenge.channel === "email" ? "email_normalized" : "phone_e164";
    const verifiedColumn = challenge.channel === "email" ? "email_verified_at" : "phone_verified_at";
    const existing = await env.DB.prepare(`
      SELECT id, role, status, email_normalized, phone_e164
      FROM marketplace_users WHERE ${column} = ? LIMIT 1
    `).bind(contact).first();
    if (existing && (existing.role !== challenge.role || existing.status !== "active")) {
      return json({ error: "This sign-in cannot be completed. Contact support if you believe this is an error." }, 403);
    }

    const userId = existing?.id || crypto.randomUUID();
    const contactFields = challenge.channel === "email"
      ? { email: contact, phone: null }
      : { email: null, phone: contact };
    const updated = await env.DB.prepare(`
      UPDATE auth_challenges SET consumed_at = unixepoch()
      WHERE id = ? AND consumed_at IS NULL AND expires_at > unixepoch()
        AND code_hash = ? AND attempts <= 5
      RETURNING id
    `).bind(challenge.id, challenge.code_hash).first();
    if (!updated) return json({ error: "The code is invalid or expired. Request a new code." }, 400);

    if (!existing) {
      const insert = await env.DB.prepare(`
        INSERT INTO marketplace_users (
          id, role, email_normalized, phone_e164, ${verifiedColumn}, status
        ) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'active')
      `).bind(userId, challenge.role, contactFields.email, contactFields.phone).run();
      if (!insert.success) throw new Error("account-create-failed");
    } else {
      await env.DB.prepare(`
        UPDATE marketplace_users SET ${verifiedColumn} = COALESCE(${verifiedColumn}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).bind(userId).run();
    }
    const user = await env.DB.prepare("SELECT id, role FROM marketplace_users WHERE id = ? AND status = 'active'").bind(userId).first();
    if (!user || user.role !== challenge.role) throw new Error("account-role-conflict");

    if (challenge.purpose === "admin_bootstrap") {
      const admins = await env.DB.prepare("SELECT COUNT(*) AS count FROM marketplace_users WHERE role = 'admin' AND status = 'active'").first("count");
      if (admins !== 1 || user.role !== "admin") throw new Error("admin-bootstrap-not-first");
    }

    const authSession = await createSession(env.DB, user.id, env.SESSION_HMAC_SECRET);
    await env.DB.prepare(`
      INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type, details_json)
      VALUES (?, ?, 'auth.sign_in', ?)
    `).bind(user.id, user.id, JSON.stringify({ role: user.role, channel: challenge.channel })).run();
    await env.DB.prepare("UPDATE auth_challenges SET contact_value = '' WHERE id = ?").bind(challenge.id).run();
    await env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < unixepoch()").run();
    return json(
      { authenticated: true, role: user.role },
      200,
      { "Set-Cookie": sessionCookie(authSession) },
    );
  } catch (error) {
    console.error(`Sign-in verification failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Sign-in is temporarily unavailable." }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
}
