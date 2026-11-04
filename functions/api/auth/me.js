import { getSession, json, marketplaceReady, methodNotAllowed } from "../../../lib/marketplace.js";

export async function onRequestGet(context) {
  if (!marketplaceReady(context.env)) return json({ error: "Marketplace sign-in is not configured." }, 503);
  const session = await getSession(context);
  if (!session) return json({ authenticated: false }, 401);
  return json({
    authenticated: true,
    user: {
      id: session.id,
      role: session.role,
      emailVerified: Boolean(session.email_verified_at),
      phoneVerified: Boolean(session.phone_verified_at),
    },
  });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed("GET");
}
