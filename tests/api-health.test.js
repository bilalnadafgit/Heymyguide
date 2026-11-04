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
    COMPANY_LEGAL_NAME: "Test Company",
    COMPANY_ENTITY_TYPE: "private limited company",
    COMPANY_REGISTRATION_DETAILS: "TEST-123",
    COMPANY_REGISTERED_ADDRESS: "1 Test Street",
    COMPANY_STATE: "Test State",
    SUPPORT_EMAIL: "support@example.com",
    PRIVACY_CONTACT_EMAIL: "privacy@example.com",
    GRIEVANCE_CONTACT_NAME: "Test Support",
    GRIEVANCE_EMAIL: "grievance@example.com",
    DATA_PROCESSING_REGION: "Test region; processor locations disclosed in approved notice",
    ADMIN_OWNER_EMAIL: "owner@example.com",
    ...overrides,
  };
}

async function marketplaceHealth(env) {
  const response = await onRequestGet({ env });
  assert.equal(response.status, 200);
  return response.json();
}

test("marketplace health stays disabled when provider or review gates are missing", async () => {
  const defaultHealth = await marketplaceHealth({});
  assert.equal(defaultHealth.marketplaceEnabled, false);
  assert.ok(defaultHealth.marketplaceBlockers.includes("database"));
  assert.ok(defaultHealth.marketplaceBlockers.includes("email_otp"));
  assert.ok(defaultHealth.marketplaceBlockers.includes("phone_otp"));

  for (const [overrides, blocker] of [
    [{ AUTH_PHONE_OTP_ENABLED: "false" }, "phone_otp"],
    [{ RESEND_API_KEY: "replace-before-enabling-email-otp" }, "email_otp"],
    [{ TWILIO_AUTH_TOKEN: "replace-before-enabling-phone-otp" }, "phone_otp"],
    [{ AUTH_HMAC_SECRET: "replace-with-at-least-32-random-characters" }, "auth_secrets"],
    [{ GUIDE_ID_VERIFICATION_PROVIDER: "" }, "guide_identity_review"],
    [{ GUIDE_ID_VERIFICATION_PROVIDER: "replace-after-provider-review" }, "guide_identity_review"],
    [{ MARKETPLACE_TERMS_APPROVED: "false" }, "marketplace_policy"],
    [{ DATA_PROCESSING_REGION: "verify-and-disclose-before-launch" }, "business_details"],
    [{ ADMIN_OWNER_EMAIL: "replace-with-owner-controlled-email" }, "admin_owner"],
  ]) {
    const health = await marketplaceHealth(configuredEnvironment(overrides));
    assert.equal(health.marketplaceEnabled, false);
    assert.ok(health.marketplaceBlockers.includes(blocker), blocker);
  }
});

test("marketplace health reports enabled only when all required gates are configured", async () => {
  const health = await marketplaceHealth(configuredEnvironment());
  assert.equal(health.marketplaceEnabled, true);
  assert.deepEqual(health.marketplaceBlockers, []);
  assert.equal(JSON.stringify(health).includes("test-resend-key"), false);
  assert.equal(JSON.stringify(health).includes("test-token"), false);
});
