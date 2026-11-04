const MAX_BODY_BYTES = 4096;
const MAX_STORAGE_TIME_MS = 4000;
const NOTICE_VERSION = "launch-interest-v1";
const EMAIL_PATTERN = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const ALLOWED_FIELDS = new Set(["kind", "email", "name", "city", "destination", "languages", "consent", "website"]);

function isConfigured(env) {
  const hasLaunchValue = (key) => typeof env[key] === "string"
    && env[key].trim()
    && !/replace|placeholder|verify-and-disclose|\[|\]/i.test(env[key]);
  const isContactEmail = (key) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env[key] || "");
  return Boolean(env.DB)
    && env.PUBLIC_LAUNCH_ENABLED === "true"
    && env.LAUNCH_PRIVACY_NOTICE_APPROVED === "true"
    && env.LAUNCH_TERMS_APPROVED === "true"
    && ["COMPANY_LEGAL_NAME", "COMPANY_ENTITY_TYPE", "COMPANY_REGISTRATION_DETAILS", "COMPANY_REGISTERED_ADDRESS", "COMPANY_STATE", "SUPPORT_EMAIL", "PRIVACY_CONTACT_EMAIL", "GRIEVANCE_CONTACT_NAME", "GRIEVANCE_EMAIL", "DATA_PROCESSING_REGION", "LEAD_RATE_LIMIT_SECRET"].every(hasLaunchValue)
    && ["SUPPORT_EMAIL", "PRIVACY_CONTACT_EMAIL", "GRIEVANCE_EMAIL"].every(isContactEmail)
    && env.LEAD_RATE_LIMIT_SECRET.length >= 32;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

async function readBoundedJson(request) {
  const advertisedLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_BODY_BYTES) {
    throw new RangeError("request-too-large");
  }
  if (!request.body) throw new SyntaxError("empty-request");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("request-too-large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).some((key) => !ALLOWED_FIELDS.has(key))) {
    return { error: "Check the submitted fields." };
  }
  if (!["traveler", "guide"].includes(payload.kind)) {
    return { error: "Choose traveler or guide interest." };
  }
  if (typeof payload.email !== "string") return { error: "Enter a valid email address." };
  const email = payload.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return { error: "Enter a valid email address." };
  if (payload.consent !== true) return { error: "Please confirm the contact consent to continue." };
  if (typeof payload.website !== "string" || payload.website.trim()) {
    return { error: "The submission could not be accepted." };
  }

  const name = payload.name ?? "";
  const city = payload.city ?? "";
  const destination = payload.destination ?? "";
  const languages = payload.languages ?? "";
  for (const [label, value, maxLength] of [["Name", name, 100], ["City", city, 80], ["Destination", destination, 100], ["Languages", languages, 160]]) {
    if (typeof value !== "string" || value.trim().length > maxLength) {
      return { error: `${label} is too long.` };
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      return { error: `Check the ${label.toLowerCase()} field.` };
    }
  }
  if (payload.kind === "guide" && !city.trim()) return { error: "Add your home city or region." };
  if (payload.kind === "guide" && !languages.trim()) return { error: "Add at least one language you can guide in." };
  if (payload.kind === "traveler" && !destination.trim()) return { error: "Choose a destination." };

  return {
    lead: {
      kind: payload.kind,
      email_normalized: email,
      display_name: name.trim() || null,
      city: city.trim() || null,
      destination: destination.trim() || null,
      languages: languages.trim() || null,
      consent_version: NOTICE_VERSION,
    },
  };
}

async function hashAddress(secret, address) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(address)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameOrigin(request) {
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

export async function onRequestPost({ request, env }) {
  if (!isConfigured(env)) {
    return jsonResponse({ error: "The interest form is not configured yet." }, 503);
  }
  if (!sameOrigin(request)) return jsonResponse({ error: "Request not allowed." }, 403);

  let payload;
  try {
    payload = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RangeError) return jsonResponse({ error: "The submission is too large." }, 413);
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const validation = validatePayload(payload);
  if (validation.error) return jsonResponse({ error: validation.error }, 400);

  const address = request.headers.get("CF-Connecting-IP");
  if (!address || address.length > 64) {
    return jsonResponse({ error: "The interest form is temporarily unavailable." }, 503);
  }

  const startedAt = Date.now();
  try {
    const ipHash = await hashAddress(env.LEAD_RATE_LIMIT_SECRET, address);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM lead_rate_limits WHERE window_started_at < unixepoch() - 86400"),
      env.DB.prepare("DELETE FROM heymyguide_leads WHERE created_at < datetime('now', '-180 days')"),
    ]);
    const rate = await env.DB.prepare(`
      INSERT INTO lead_rate_limits (ip_hash, window_started_at, request_count)
      VALUES (?, unixepoch(), 1)
      ON CONFLICT(ip_hash) DO UPDATE SET
        request_count = CASE
          WHEN window_started_at <= unixepoch() - 900 THEN 1
          ELSE request_count + 1
        END,
        window_started_at = CASE
          WHEN window_started_at <= unixepoch() - 900 THEN unixepoch()
          ELSE window_started_at
        END
      RETURNING request_count
    `).bind(ipHash).first("request_count");
    if (typeof rate !== "number") throw new Error("rate-limit-unavailable");
    if (rate > 5) {
      return jsonResponse(
        { error: "Too many attempts. Please wait a little and try again." },
        429,
        { "Retry-After": "900" },
      );
    }

    if (Date.now() - startedAt > MAX_STORAGE_TIME_MS) {
      return jsonResponse({ error: "The interest form is temporarily unavailable." }, 503);
    }
    const { lead } = validation;
    const result = await env.DB.prepare(`
      INSERT INTO heymyguide_leads (
        kind, email_normalized, display_name, city, destination, languages, consent_version, source_ip_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, email_normalized) DO NOTHING
    `).bind(
      lead.kind,
      lead.email_normalized,
      lead.display_name,
      lead.city,
      lead.destination,
      lead.languages,
      lead.consent_version,
      ipHash,
    ).run();
    if (!result.success) throw new Error("lead-insert-failed");
  } catch (error) {
    console.error(`Lead intake unavailable: ${error instanceof Error ? error.name : "unknown error"}`);
    return jsonResponse({ error: "The interest form is temporarily unavailable." }, 503);
  }

  return jsonResponse({ accepted: true }, 201);
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return jsonResponse({ error: "Method not allowed." }, 405, { Allow: "POST" });
}
