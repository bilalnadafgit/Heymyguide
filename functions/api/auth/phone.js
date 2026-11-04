import {
  consumeRateLimit,
  channelReady,
  getSession,
  hmac,
  json,
  marketplaceReady,
  methodNotAllowed,
  randomDigits,
  readJson,
  sameOriginJson,
  secureEqual,
  sendOtp,
  validObject,
  uuid,
} from "../../../lib/marketplace.js";

function validPhone(value) {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
}

export async function onRequestPost({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Marketplace phone verification is not configured." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!session || session.role !== "traveler") return json({ error: "Sign in as a traveler to verify your phone." }, 401);
  if (!session.email_verified_at) return json({ error: "Verify your email before adding a phone number." }, 403);

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validObject(payload, ["action", "phone", "challengeId", "code"]) || typeof payload.action !== "string") {
    return json({ error: "Check the phone verification fields." }, 400);
  }
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 64) return json({ error: "Phone verification is temporarily unavailable." }, 503);

  if (payload.action === "request") {
    if (!validPhone(payload.phone)) return json({ error: "Enter a phone number in international format (E.164)." }, 400);
    if (session.phone_verified_at) return json({ error: "This account already has a verified phone number." }, 409);
    if (!channelReady(env, "phone")) {
      return json({ error: "Phone verification is not configured." }, 503);
    }
    try {
      const owner = await env.DB.prepare(`
        SELECT id FROM marketplace_users
        WHERE phone_e164 = ? AND id <> ? LIMIT 1
      `).bind(payload.phone, session.id).first();
      if (owner) return json({ error: "This phone number is already linked to another account." }, 409);
      if (!(await consumeRateLimit(env.DB, env.AUTH_HMAC_SECRET, `phone-link-ip:${ip}`, 10, 900))
        || !(await consumeRateLimit(env.DB, env.AUTH_HMAC_SECRET, `phone-link-user:${session.id}`, 5, 900))
        || !(await consumeRateLimit(env.DB, env.AUTH_HMAC_SECRET, `phone-link-contact:${payload.phone}`, 5, 900))) {
        return json({ error: "Too many verification requests. Please wait and try again." }, 429, { "Retry-After": "900" });
      }
      await env.DB.prepare("DELETE FROM traveler_phone_link_challenges WHERE expires_at < unixepoch() OR created_at < unixepoch() - 86400").run();
      const id = uuid();
      const code = randomDigits(6);
      const codeHash = await hmac(env.AUTH_HMAC_SECRET, `${id}:${session.id}:${code}`);
      await env.DB.prepare(`
        INSERT INTO traveler_phone_link_challenges (id, user_id, phone_e164, code_hash, expires_at)
        VALUES (?, ?, ?, ?, unixepoch() + 300)
      `).bind(id, session.id, payload.phone, codeHash).run();
      try {
        await sendOtp(env, "phone", payload.phone, code);
      } catch (error) {
        await env.DB.prepare("DELETE FROM traveler_phone_link_challenges WHERE id = ?").bind(id).run();
        throw error;
      }
      return json({ challengeId: id, expiresInSeconds: 300 });
    } catch (error) {
      console.error(`Traveler phone verification request failed: ${error instanceof Error ? error.name : "unknown error"}`);
      return json({ error: "Phone verification could not be sent." }, 503);
    }
  }

  if (payload.action === "verify") {
    if (typeof payload.challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.challengeId)
      || typeof payload.code !== "string" || !/^\d{6}$/.test(payload.code)) {
      return json({ error: "Enter the six-digit verification code." }, 400);
    }
    try {
      const challenge = await env.DB.prepare(`
        SELECT phone_e164, code_hash, expires_at, attempts, consumed_at
        FROM traveler_phone_link_challenges
        WHERE id = ? AND user_id = ? LIMIT 1
      `).bind(payload.challengeId, session.id).first();
      if (!challenge || challenge.consumed_at !== null
        || challenge.expires_at <= Math.floor(Date.now() / 1000) || challenge.attempts >= 5) {
        return json({ error: "The verification code is invalid or expired." }, 400);
      }
      const attempt = await env.DB.prepare(`
        UPDATE traveler_phone_link_challenges SET attempts = attempts + 1
        WHERE id = ? AND user_id = ? AND consumed_at IS NULL
          AND expires_at > unixepoch() AND attempts < 5
        RETURNING attempts
      `).bind(payload.challengeId, session.id).first();
      if (!attempt) return json({ error: "The verification code is invalid or expired." }, 400);
      const supplied = await hmac(env.AUTH_HMAC_SECRET, `${payload.challengeId}:${session.id}:${payload.code}`);
      if (!secureEqual(supplied, challenge.code_hash)) return json({ error: "The verification code is invalid or expired." }, 400);

      const result = await env.DB.batch([
        env.DB.prepare(`
          UPDATE traveler_phone_link_challenges SET consumed_at = unixepoch()
          WHERE id = ? AND user_id = ? AND consumed_at IS NULL
            AND expires_at > unixepoch() AND code_hash = ? AND attempts <= 5
          RETURNING id
        `).bind(payload.challengeId, session.id, challenge.code_hash),
        env.DB.prepare(`
          UPDATE marketplace_users SET phone_e164 = ?,
              phone_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND role = 'traveler' AND status = 'active'
            AND email_verified_at IS NOT NULL AND phone_verified_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM marketplace_users other
              WHERE other.phone_e164 = ? AND other.id <> marketplace_users.id
            )
          RETURNING id
        `).bind(challenge.phone_e164, session.id, challenge.phone_e164),
      ]);
      if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1) {
        return json({ error: "The phone number is already linked, or account verification changed. Sign in again and retry." }, 409);
      }
      await env.DB.prepare(`
        INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, event_type, details_json)
        VALUES (?, ?, 'auth.traveler_phone_verified', '{}')
      `).bind(session.id, session.id).run();
      await env.DB.prepare("DELETE FROM traveler_phone_link_challenges WHERE id = ?").bind(payload.challengeId).run();
      return json({ phoneVerified: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
        return json({ error: "This phone number is already linked to another account." }, 409);
      }
      console.error(`Traveler phone verification failed: ${error instanceof Error ? error.name : "unknown error"}`);
      return json({ error: "Phone verification could not be completed." }, 503);
    }
  }
  return json({ error: "Choose request or verify." }, 400);
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
}
