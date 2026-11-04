import {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  channelReady,
  consumeRateLimit,
  hmac,
  json,
  marketplaceReady,
  methodNotAllowed,
  randomDigits,
  readJson,
  sameOriginJson,
  sendOtp,
  uuid,
  validObject,
} from "../../../lib/marketplace.js";

function normalizeContact(channel, value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (channel === "email") {
    const email = normalized.toLowerCase();
    return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
  }
  return PHONE_PATTERN.test(normalized) ? normalized : null;
}

function adminOwner(env, email) {
  return typeof env.ADMIN_OWNER_EMAIL === "string"
    && env.ADMIN_OWNER_EMAIL.trim().toLowerCase() === email;
}

export async function onRequestPost({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Marketplace sign-in is not configured." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validObject(payload, ["role", "channel", "email", "phone"])) return json({ error: "Check the submitted fields." }, 400);

  const role = payload.role;
  const channel = payload.channel;
  if (!["traveler", "guide", "admin"].includes(role) || !["email", "phone"].includes(channel)) {
    return json({ error: "Choose an available account type and sign-in method." }, 400);
  }
  if (role === "guide" && channel !== "phone") {
    return json({ error: "Guide sign-in requires phone verification." }, 400);
  }
  if (role === "admin" && channel !== "email") {
    return json({ error: "Admin sign-in requires the owner email." }, 400);
  }
  if (!channelReady(env, channel)) return json({ error: `${channel === "phone" ? "Phone" : "Email"} verification is not configured.` }, 503);

  const field = channel === "email" ? "email" : "phone";
  const destination = normalizeContact(channel, payload[field]);
  if (!destination) return json({ error: channel === "phone" ? "Enter a phone number in international format (E.164)." : "Enter a valid email address." }, 400);
  if (channel === "phone" && payload.email !== undefined || channel === "email" && payload.phone !== undefined) {
    return json({ error: "Send only the selected sign-in contact." }, 400);
  }

  const isOwner = role === "admin" && adminOwner(env, destination);
  if (role === "admin" && !isOwner) return json({ error: "Admin sign-in is unavailable." }, 403);
  let purpose = "sign_in";
  if (role === "admin") {
    const adminCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM marketplace_users WHERE role = 'admin' AND status = 'active'").first("count");
    if (adminCount === 0) {
      if (env.ADMIN_BOOTSTRAP_ENABLED !== "true") return json({ error: "Secure admin setup is not enabled." }, 503);
      purpose = "admin_bootstrap";
    } else {
      const owner = await env.DB.prepare("SELECT id FROM marketplace_users WHERE role = 'admin' AND email_normalized = ? AND status = 'active'").bind(destination).first();
      if (!owner) return json({ error: "Admin sign-in is unavailable." }, 403);
    }
  }

  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 64) return json({ error: "Sign-in is temporarily unavailable." }, 503);
  try {
    if (!(await consumeRateLimit(env.DB, env.AUTH_HMAC_SECRET, `ip:${ip}`, 10, 900))
      || !(await consumeRateLimit(env.DB, env.AUTH_HMAC_SECRET, `contact:${role}:${destination}`, 5, 900))) {
      return json({ error: "Too many sign-in requests. Please wait and try again." }, 429, { "Retry-After": "900" });
    }
    await env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < unixepoch() - 86400").run();
    await env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < unixepoch() OR created_at < unixepoch() - 86400").run();
    const id = uuid();
    const code = randomDigits(6);
    const subjectHash = await hmac(env.AUTH_HMAC_SECRET, `${role}:${destination}`);
    const codeHash = await hmac(env.AUTH_HMAC_SECRET, `${id}:${code}`);
    await env.DB.prepare(`
      INSERT INTO auth_challenges (
        id, subject_hash, purpose, role, channel, contact_value, code_hash, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() + 300)
    `).bind(id, subjectHash, purpose, role, channel, destination, codeHash).run();
    try {
      await sendOtp(env, channel, destination, code);
    } catch (error) {
      await env.DB.prepare("DELETE FROM auth_challenges WHERE id = ?").bind(id).run();
      throw error;
    }
    return json({ accepted: true, challengeId: id, expiresInSeconds: 300 });
  } catch (error) {
    console.error(`Sign-in request failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Sign-in is temporarily unavailable." }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
}
