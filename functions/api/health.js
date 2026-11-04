import { marketplaceBlockers } from "../../lib/marketplace.js";

function isConfigured(env) {
  const required = [
    "PUBLIC_LAUNCH_ENABLED",
    "LAUNCH_PRIVACY_NOTICE_APPROVED",
    "LAUNCH_TERMS_APPROVED",
    "COMPANY_LEGAL_NAME",
    "COMPANY_ENTITY_TYPE",
    "COMPANY_REGISTRATION_DETAILS",
    "COMPANY_REGISTERED_ADDRESS",
    "COMPANY_STATE",
    "SUPPORT_EMAIL",
    "PRIVACY_CONTACT_EMAIL",
    "GRIEVANCE_CONTACT_NAME",
    "GRIEVANCE_EMAIL",
    "DATA_PROCESSING_REGION",
    "LEAD_RATE_LIMIT_SECRET",
  ];
  const hasLaunchValue = (key) => typeof env[key] === "string"
    && env[key].trim()
    && !/replace|placeholder|verify-and-disclose|\[|\]/i.test(env[key]);
  const isContactEmail = (key) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env[key] || "");
  return Boolean(env.DB)
    && required.every(hasLaunchValue)
    && ["SUPPORT_EMAIL", "PRIVACY_CONTACT_EMAIL", "GRIEVANCE_EMAIL"].every(isContactEmail)
    && env.PUBLIC_LAUNCH_ENABLED === "true"
    && env.LAUNCH_PRIVACY_NOTICE_APPROVED === "true"
    && env.LAUNCH_TERMS_APPROVED === "true"
    && env.LEAD_RATE_LIMIT_SECRET.length >= 32;
}

export async function onRequestGet({ env }) {
  const blockers = marketplaceBlockers(env);
  return Response.json(
    {
      leadIntakeEnabled: isConfigured(env),
      marketplaceEnabled: blockers.length === 0,
      marketplaceBlockers: blockers,
      ...(isConfigured(env) ? { supportEmail: env.SUPPORT_EMAIL } : {}),
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } },
  );
}
