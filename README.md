# heymyGuide — marketplace prototype

This repository contains a responsive public pre-launch site, account-backed traveler/guide/admin portal screens, and a Cloudflare D1 marketplace API that is **disabled by default**. The production portal UI is not accepting users or bookings: real OTP delivery, legal approvals and guide identity verification are not configured. Do not treat the current site as an open travel marketplace.

Project source is MIT-licensed; see [`LICENSE`](./LICENSE). The site has no build step or runtime dependencies. Public files are served from `public/`; Cloudflare Pages Functions live in `functions/`; the D1 schema is in `migrations/`.

## What works

- Responsive marketing pages with illustrative destination photography.
- Account-backed portal screens in `public/marketplace-ui.js` for passwordless sign-in, traveler guide search/bookings/reports, guide profile/rates/experiences/availability/trip actions, and admin reports/guide review. These screens call the real same-origin API, but the marketplace gate keeps them unavailable until required settings are approved and configured.
- The account-backed traveler and guide screens call real same-origin API routes for profiles, guide discovery, availability, bookings, safety reports and trip-status actions. These routes remain inaccessible while the server-side marketplace gate is off.
- Worldwide traveler and guide interest forms, including home region/destination and languages, opened only after the backend readiness endpoint reports that launch is configured.
- Same-origin server-side input validation, strict field allow-list, required consent, size cap, hidden honeypot, rate limiting (5 submissions/IP hash/15 minutes), deduplication, and generic provider-error responses.
- Interest information is stored only in Cloudflare D1. The source IP is HMAC-hashed with a secret before its rate-limit fingerprint is stored; the raw IP is not saved by this function.
- Privacy and terms drafts are explicitly marked incomplete. The API remains closed until the launch flags and company/provider settings are configured.
- D1 migrations define user/session/OTP-challenge records, guide profiles with external identity-verification references only, experiences, availability, bookings, completion-code challenges, cash status, audit events, and safety reports. Migration `0003` adds secure phone linking for email-verified traveler accounts.
- Pages Functions provide email/phone OTP sign-in, phone linking, sessions/logout, guide profiles and experiences, guide availability, public guide discovery, bookings, completion-code checks, cash status, safety reports, and admin review. These routes fail closed unless explicit production, legal, secret, and provider gates are configured.

## Preview locally

Opening `public/index.html` directly shows the public site, but its API-backed forms remain unavailable outside a Pages deployment/local Pages runtime. Browser preview is not a launch or form-submission test.

To run Cloudflare Pages Functions locally, install a supported Node.js LTS release and Wrangler on your own machine, create a development D1 database, apply the migration, copy `.dev.vars.example` to `.dev.vars`, and keep all launch flags `false` until the legal and provider checklist below is complete. Never put real keys in a committed file.

## Deploy a preview on Cloudflare Pages

1. The source is already available in the GitHub repository's `main` branch. Do not force-push or replace its history.
2. The Cloudflare Pages project `heymyguide` already exists and serves the production pre-launch site at `https://heymyguide.pages.dev/`. Its Git provider is not connected; deployments are uploaded manually with Wrangler. Use `public` as the output directory. Cloudflare Pages Functions in `functions/` are deployed with the site.
3. The production D1 database `heymyguide-marketplace` has been created with an APAC location hint. Migrations through `0003` have been applied remotely. Its `DB` binding and migration directory are declared in [`wrangler.toml`](./wrangler.toml); deploy with Wrangler so the Functions receive that binding.
4. Add the configuration variables from `.dev.vars.example` to the **production** Pages Functions environment only after replacing every placeholder and reviewing the checklist below. Keep all launch switches `false` initially. Never add `.dev.vars` to Git.
5. In an isolated preview environment, verify interest-form variants, D1 inserts/duplicates/rate limits, security headers, and rollback behavior using test data and explicitly scoped test settings. Never enable production collection for this test.
6. Only after company/contact details and reviewed notices are approved, consider setting `LAUNCH_PRIVACY_NOTICE_APPROVED=true`, `LAUNCH_TERMS_APPROVED=true`, and `PUBLIC_LAUNCH_ENABLED=true`; redeploy and verify readiness and a test entry.
7. Add the domain in the Cloudflare Pages project and follow the dashboard's DNS/TLS instructions. Configure a second owner with MFA and least privilege; do not share passwords or recovery codes.

The Pages project, production deployment, D1 database, and remote migrations are configured. The APAC setting is a location hint, not a promise of data residency; confirm Cloudflare's current processing and transfer terms before collecting personal data and disclose them accurately. The production health endpoint reports both public intake and marketplace disabled. Pages is not connected to GitHub for automatic deployments. API handlers have not been integration-tested against production D1, and no OTP or identity-verification provider is configured.

## Vercel static preview

`vercel.json` points Vercel at `public/` for a **static preview only**. The project’s Pages Functions in `functions/` require Cloudflare Pages and D1; they do not become working Vercel API routes. Sign-in, guides, bookings, safety reports, and interest-form API submissions will not work on a Vercel static deployment. Do not configure this as the live marketplace.

Vercel's current [Terms of Service](https://vercel.com/legal/terms) state that its free Hobby plan is for personal or non-commercial use. heymyGuide is a business, so do not deploy it for commercial use on Hobby. Use a Vercel plan whose terms permit the business, or choose an appropriate alternative. Account authorization, project import, settings, and deployment must be completed from the owner's authenticated provider dashboard.

## Marketplace backend prototype status

The API and schema are implementation groundwork, not a complete or end-to-end tested marketplace. Production D1 migrations through `0003` are applied. The public health endpoint reports `marketplaceEnabled: false`. Marketplace health remains false until D1, launch/legal approvals, marketplace switches, complete company/contact/data-processing disclosures, owner-admin email, authentication secrets, both OTP channels, and guide identity-review settings are configured. The health endpoint returns non-secret `marketplaceBlockers` codes to help diagnose missing settings. Health checks configuration presence only; they do not send a test OTP, check provider availability, validate a provider's legal suitability, or independently verify guide identities. Marketplace routes also fail closed unless their server-side gates pass. Setting example values to `true` does not make the product safe or production-ready.

The current routes cover basic OTP delivery/verification (Resend email and Twilio SMS), traveler phone linking, sessions/roles, owner-email admin bootstrap, guide profiles/experiences, guide availability, guide discovery, booking request/accept/decline/start/cancel, trip-completion OTP, direct-cash status, reports and admin review. The schema migrations ran against production D1, but no end-to-end API flow has been run against it. The current guide ID review is manual using a provider reference; there is no identity-provider API or callback, and the app cannot determine whether a reference is genuine. Do not approve guides until a lawful provider workflow is configured and independently verified.

The account-backed portal UI now calls the marketplace routes, and email-verified travelers can link a verified phone when SMS is configured. Still missing are secure user chat/translation, profile-photo upload/storage, guide ratings/reviews, complete legal/cancellation/support operations, alerting, and production monitoring. Guide identity documents are deliberately not stored in D1. A guide's cash-received report is not proof of payment; no funds are held or settled by the platform. The completion code must be entered privately by the traveler and never disclosed to the guide.

Before any real customer or guide access, test the migration and all APIs against D1, complete the missing product/UI and operational flows, configure providers and secrets, and complete legal/privacy review, security testing, deployment verification, monitoring, and rollback tests. Never put admin passwords, bootstrap secrets, OTPs, provider keys, or identity documents in this repository or chat.

## Required production settings

See `.dev.vars.example`. In addition to the D1 `DB` binding, configure:

- `PUBLIC_LAUNCH_ENABLED=false` until manually approved.
- `LAUNCH_PRIVACY_NOTICE_APPROVED=false` and `LAUNCH_TERMS_APPROVED=false` until all placeholders have been replaced and an India-qualified professional has reviewed the notices for the actual business model.
- `MARKETPLACE_ENABLED=false`, `MARKETPLACE_PRIVACY_NOTICE_APPROVED=false`, `MARKETPLACE_TERMS_APPROVED=false`, and `MARKETPLACE_GLOBAL_REGIONS_REVIEWED=false` until the marketplace itself—not only the interest form—has been legally and operationally reviewed for every served region.
- `AUTH_HMAC_SECRET` and `SESSION_HMAC_SECRET` as separate random secrets of at least 32 characters. Keep them in the provider's secret store, never in Git.
- `AUTH_EMAIL_OTP_ENABLED=false` unless Resend is set up with an approved sender, and `AUTH_PHONE_OTP_ENABLED=false` unless Twilio is configured for the supported countries and sender. OTP delivery may cost money and is not guaranteed by a free plan.
- `ADMIN_BOOTSTRAP_ENABLED=false` until the owner-controlled email, D1 database, and provider delivery are verified. Enable only for the first admin setup, then turn it off. Never share credentials or OTPs.
- `GUIDE_ID_VERIFICATION_ENABLED=false` until an actual lawful identity provider and its review procedure are configured. `GUIDE_ID_VERIFICATION_PROVIDER` is only a label; it does not integrate or verify that provider.
- The exact legal entity and entity type, applicable registration details, full registered address and state, support email, privacy contact email, grievance contact name/email, and an accurate description of where/how submitted details are processed. These are **not optional defaults**. Do not invent them.
- `LEAD_RATE_LIMIT_SECRET` as a random secret of at least 32 characters, stored only in the Pages Functions environment (not a public `vars` file if the dashboard offers a secret setting).

Keep the intake switches off if any item is missing. The health route checks configuration presence, not a real database transaction, a test OTP delivery, the legal adequacy of the notices, or provider/identity-review outcomes. A successful readiness response is not a legal or security approval.

## India launch and business checklist

This is an engineering checklist, not legal, tax, employment, insurance, or regulatory advice. Ask India-qualified counsel and a chartered accountant to review the specific company, contracts, marketplace role, regions served, pricing, and payment flow before taking bookings.

- Confirm every business, contact, processing, retention, withdrawal/deletion and grievance detail in [`public/privacy.html`](./public/privacy.html) and [`public/terms.html`](./public/terms.html), including notice version and processor/subprocessor list. Ensure disclosures match the actual deployment and have them reviewed before publication; remove their `noindex` directives only after approval.
- Confirm applicability and commencement/transition rules for the Digital Personal Data Protection Act, 2023 and rules in force, consumer/e-commerce disclosures, IT/security incident duties, and the entity's grievance and record-keeping obligations. Publish only reviewed, accurate notices.
- Confirm GST registration, invoicing, TCS/marketplace/operator treatment, guide classification, labour/contract status, local tourism permissions, insurance/liability, and consumer cancellation/refund obligations with counsel/CA. Applicability depends on how the service is actually structured.
- Choose processors after privacy/security, contract, pricing and data-region review. Free-tier usage has quota limits and provider-specific terms. Cloudflare Pages/Workers/D1 are hosted commercial services, not all-open-source software; this site code has no package dependencies, but hosting is not self-hosted.
- D1 placement and provider access/transfer details must be checked and accurately disclosed. Do not infer that information stays in India. If the required storage/transfer posture is not acceptable, choose a provider/plan/architecture with the needed regional controls before collecting addresses.
- The retention period is not automatic. Review and manually run an approved deletion procedure at least monthly; delete withdrawn/expired interest only under the published schedule and any legal hold. D1 access is admin-level, so enable MFA and tightly restrict access. Never share exports in chat.
- The intake also prunes entries older than 180 days on a subsequent submission. For a quiet site, manually run `DELETE FROM heymyguide_leads WHERE created_at < datetime('now', '-180 days');` at least monthly so inactivity does not extend retention.
- Test accessibility, keyboard/screen-reader flows, email deliverability, abuse controls, data deletion, backups/restore, incident response, and rollback. Free plans do not supply a zero-downtime guarantee or an enterprise SLA. Monitor quotas and alerts.

The waitlist is only a way to ask permission to contact someone about their interest. It does not provide double-opt-in email verification, and the address is not proof of identity. No one should send ID, OTP, payment, health, or other sensitive information through it.

## Portal implementation status

The three portal buttons open the account-backed interface:

- **Traveler:** passwordless sign-in, location-filtered approved guide discovery, open-slot booking requests, booking status, safety reports, trip-completion code entry, and cash-status confirmation. These actions require the marketplace gate and configured OTP delivery.
- **Guide:** passwordless phone sign-in, editable profile and daily fee, experiences, future availability, booking responses, trip status and cash-receipt reporting. Profiles remain unlisted until externally verified and approved.
- **Admin:** owner-email sign-in, live operational counts, report review, and guide-review workflow. Admin bootstrap and review remain blocked until configured; an entered provider reference is not independently verified by the app.

The chat language selector does not translate or send messages. A translation provider must be selected and privacy-reviewed. The trip-completion copy describes a future flow where the traveler enters the completion OTP in the authenticated service; travelers must never share that code with the guide. Phone verification/SMS is not configured.

These interfaces do not by themselves make the product production-ready. Secure chat/translation, profile photos, ratings/reviews, cancellation and support operations, monitoring, legal review, provider setup, and end-to-end testing remain outstanding. Keep public intake and all transactions disabled until those prerequisites are deployed and verified.

## When marketplace onboarding is ready

These are separate, non-free or approval-dependent integrations; none is enabled in this phase:

- **Phone OTP in India:** compare providers such as MSG91, Exotel, or Kaleyra for current terms, delivery, privacy, security, and support. Confirm TRAI commercial messaging/DLT Principal Entity, header, template, consent, and route requirements before sending production SMS. OTP traffic and sender onboarding generally require a provider account and can incur charges.
- **Identity checks:** engage an eligible provider (for example, compare IDfy, HyperVerge, Signzy, and Digio only after current due diligence). Confirm what verification is lawful for this marketplace, provider approvals, security, retention/deletion, grievance handling, and cost. Never collect Aadhaar/ID files in the browser or store them in D1; use a legally appropriate, specialist verification flow and store only the minimum result/reference needed.
- **Payments:** compare providers such as Razorpay and Cashfree for current fees, settlement, refund/dispute tooling, marketplace/split-settlement eligibility, KYC, and contracts. Verify regulatory status and applicable RBI requirements at onboarding. Never store card numbers, CVVs, UPI PINs, OTPs, or payment credentials.
- **Marketplace operations:** real user authentication and role permissions; traveler/guide messaging with blocking/reporting; identity-status review and audit trail; booking terms and expense breakdown; complaint/safety incident response and appeal; verified-trip reviews; transport/accommodation partner boundaries; cancellation, refund, tax, and accounting flows; support coverage.

Provider examples are starting points for diligence, not endorsements, guarantees of approval, or a claim that the services are free.

## Hosting limits and uptime

Cloudflare documents a free Workers allowance and D1 daily/storage limits; they can change and are not an uptime commitment. Free infrastructure may be throttled or unavailable, and a single region/account/domain cannot guarantee zero downtime. Never promise that a launch will have no outages. Add monitoring, tested backups, recovery drills, deployment rollback, domain renewal, and a paid plan/SLA if the business requires an availability commitment.

Vercel's current [Hobby terms](https://vercel.com/legal/terms) restrict that plan to personal or non-commercial use and reserve broad deployment shutdown discretion. Because heymyGuide is a business, this free-tier setup targets Cloudflare Pages instead; use a Vercel plan explicitly permitted for commercial use if you choose Vercel.

Official platform references: [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/), [Cloudflare Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/), [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and [Vercel terms](https://vercel.com/legal/terms). Recheck current plans/terms before deployment.
