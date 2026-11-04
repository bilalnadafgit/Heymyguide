export const MAX_JSON_BYTES = 8192;
export const EMAIL_PATTERN = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
export const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
export const SESSION_COOKIE = "__Host-heymyguide_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}

export function methodNotAllowed(allow) {
  return json({ error: "Method not allowed." }, 405, { Allow: allow });
}

export function marketplaceReady(env) {
  return Boolean(env.DB)
    && env.MARKETPLACE_ENABLED === "true"
    && env.MARKETPLACE_PRIVACY_NOTICE_APPROVED === "true"
    && env.MARKETPLACE_TERMS_APPROVED === "true"
    && env.MARKETPLACE_GLOBAL_REGIONS_REVIEWED === "true"
    && typeof env.AUTH_HMAC_SECRET === "string"
    && env.AUTH_HMAC_SECRET.length >= 32
    && typeof env.SESSION_HMAC_SECRET === "string"
    && env.SESSION_HMAC_SECRET.length >= 32
    && env.PUBLIC_LAUNCH_ENABLED === "true"
    && env.LAUNCH_PRIVACY_NOTICE_APPROVED === "true"
    && env.LAUNCH_TERMS_APPROVED === "true";
}

export function channelReady(env, channel) {
  if (!marketplaceReady(env)) return false;
  if (channel === "email") {
    return env.AUTH_EMAIL_OTP_ENABLED === "true"
      && typeof env.RESEND_API_KEY === "string"
      && env.RESEND_API_KEY.length > 10
      && typeof env.OTP_FROM_EMAIL === "string"
      && EMAIL_PATTERN.test(env.OTP_FROM_EMAIL);
  }
  if (channel === "phone") {
    return env.AUTH_PHONE_OTP_ENABLED === "true"
      && typeof env.TWILIO_ACCOUNT_SID === "string"
      && typeof env.TWILIO_AUTH_TOKEN === "string"
      && typeof env.TWILIO_FROM_NUMBER === "string"
      && PHONE_PATTERN.test(env.TWILIO_FROM_NUMBER);
  }
  return false;
}

export function sameOriginJson(request) {
  const origin = request.headers.get("Origin");
  if (!origin || request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function readJson(request) {
  const advertised = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(advertised) && advertised > MAX_JSON_BYTES) throw new RangeError("request-too-large");
  if (!request.body) throw new SyntaxError("empty-request");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new RangeError("request-too-large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function validObject(value, fields) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => fields.includes(key));
}

export function uuid() {
  return crypto.randomUUID();
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export function secureEqual(first, second) {
  if (typeof first !== "string" || typeof second !== "string" || first.length !== second.length) return false;
  let diff = 0;
  for (let index = 0; index < first.length; index += 1) diff |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return diff === 0;
}

export function randomDigits(length = 6) {
  const max = 10 ** length;
  const ceiling = Math.floor(0x100000000 / max) * max;
  const bytes = new Uint32Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= ceiling);
  return String(bytes[0] % max).padStart(length, "0");
}

export async function consumeRateLimit(db, secret, key, limit, windowSeconds) {
  const keyHash = await hmac(secret, key);
  const count = await db.prepare(`
    INSERT INTO auth_rate_limits (rate_key_hash, window_started_at, request_count)
    VALUES (?, unixepoch(), 1)
    ON CONFLICT(rate_key_hash) DO UPDATE SET
      request_count = CASE
        WHEN window_started_at <= unixepoch() - ? THEN 1
        ELSE request_count + 1
      END,
      window_started_at = CASE
        WHEN window_started_at <= unixepoch() - ? THEN unixepoch()
        ELSE window_started_at
      END
    RETURNING request_count
  `).bind(keyHash, windowSeconds, windowSeconds).first("request_count");
  return typeof count === "number" && count <= limit;
}

export function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}

function readCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export async function getSession(context) {
  if (!marketplaceReady(context.env)) return null;
  const token = readCookie(context.request, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await hmac(context.env.SESSION_HMAC_SECRET, token);
  return context.env.DB.prepare(`
    SELECT user.id, user.role, user.email_normalized, user.phone_e164,
           user.status, user.email_verified_at, user.phone_verified_at
    FROM auth_sessions session
    JOIN marketplace_users user ON user.id = session.user_id
    WHERE session.id_hash = ?
      AND session.expires_at > unixepoch()
      AND session.revoked_at IS NULL
      AND user.status = 'active'
    LIMIT 1
  `).bind(tokenHash).first();
}

export function requireRole(session, roles) {
  return Boolean(session && roles.includes(session.role));
}

export async function createSession(db, userId, secret) {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hmac(secret, token);
  await db.prepare("INSERT INTO auth_sessions (id_hash, user_id, expires_at) VALUES (?, ?, unixepoch() + ?)")
    .bind(tokenHash, userId, SESSION_TTL_SECONDS)
    .run();
  return token;
}

export async function sendOtp(env, channel, destination, code) {
  let response;
  if (channel === "email") {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.OTP_FROM_EMAIL,
        to: [destination],
        subject: "Your heymyGuide sign-in code",
        text: `Your heymyGuide sign-in code is ${code}. It expires in 5 minutes. Never share this code with anyone. If you did not request it, you can ignore this message.`,
      }),
    });
  } else if (channel === "phone") {
    const body = new URLSearchParams({
      From: env.TWILIO_FROM_NUMBER,
      To: destination,
      Body: `Your heymyGuide sign-in code is ${code}. It expires in 5 minutes. Never share this code with a guide or anyone else.`,
    });
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } else {
    throw new Error("otp-channel-unsupported");
  }
  if (!response.ok) {
    console.error(`OTP provider rejected request: ${channel} ${response.status}`);
    throw new Error("otp-provider-rejected");
  }
}
