import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequestGet } from "../functions/api/health.js";

function configuredEnvironment(overrides = {}) {
  return {
    DB: {}, MARKETPLACE_ENABLED: "true",
    MARKETPLACE_PRIVACY_NOTICE_APPROVED: "true",
    MARKETPLACE_TERMS_APPROVED: "true",
    MARKETPLACE_GLOBAL_REGIONS_REVIEWED: "true",
    AUTH_HMAC_SECRET: "a".repeat(32), SESSION_HMAC_SECRET: "b".repeat(32),
    PUBLIC_LAUNCH_ENABLED: "true", LAUNCH_PRIVACY_NOTICE_APPROVED: "true",
    LAUNCH_TERMS_APPROVED: "true", AUTH_EMAIL_OTP_ENABLED: "true",
    RESEND_API_KEY: "test-resend-key", OTP_FROM_EMAIL: "no-reply@example.com",
    AUTH_PHONE_OTP_ENABLED: "true", TWILIO_ACCOUNT_SID: "test-account",
    TWILIO_AUTH_TOKEN: "test-token", TWILIO_FROM_NUMBER: "+14155550123",
    GUIDE_ID_VERIFICATION_ENABLED: "true", GUIDE_ID_VERIFICATION_PROVIDER: "test-provider",
    ...overrides,
  };
}

async function marketplaceEnabled(env) {
  const response = await onRequestGet({ env });
  assert.equal(response.status, 200);
  return (await response.json()).marketplaceEnabled;
}

test("marketplace health stays disabled when provider or review gates are missing", async () => {
  assert.equal(await marketplaceEnabled({}), false);
  assert.equal(await marketplaceEnabled(configuredEnvironment({ AUTH_PHONE_OTP_ENABLED: "false" })), false);
  assert.equal(await marketplaceEnabled(configuredEnvironment({ GUIDE_ID_VERIFICATION_PROVIDER: "" })), false);
  assert.equal(await marketplaceEnabled(configuredEnvironment({ GUIDE_ID_VERIFICATION_PROVIDER: "replace-after-provider-review" })), false);
  assert.equal(await marketplaceEnabled(configuredEnvironment({ MARKETPLACE_TERMS_APPROVED: "false" })), false);
});

test("marketplace health reports enabled only when all required gates are configured", async () => {
  assert.equal(await marketplaceEnabled(configuredEnvironment()), true);
});
