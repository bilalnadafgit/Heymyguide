# heymyGuide — marketplace prototype

This repository contains a responsive public pre-launch site, non-functional portal walkthroughs, and an **untested, disabled-by-default** Cloudflare D1 marketplace API prototype. It is not a production travel marketplace and must not be opened to real customers or guides. The existing API groundwork does not provide complete onboarding, identity verification, messaging/translation, photos, operational controls, or an end-user interface for real bookings.

Project source is MIT-licensed; see [`LICENSE`](./LICENSE). The site has no build step or runtime dependencies. Public files are served from `public/`; Cloudflare Pages Functions live in `functions/`; the D1 schema is in `migrations/`.

## What works

- Responsive marketing pages with illustrative destination photography.
- Traveler, guide and staff portal walkthroughs, explicitly marked as examples and not connected to accounts or real data.
- Sample guide-local availability, an editable session-only example daily guide fee (including currency), a proposed cash-to-guide-at-trip-end display, future online payment placeholder, language selector/translation-provider notice, and trip-completion OTP safety explanation. The traveler walkthrough also has cascading country/region/city selectors, manual location entry, and fictional local guide profiles ordered by exact city, region, then country match for a small sample of destinations. Saving the sample Srinagar guide fee updates that profile in traveler search for the current browser session only. There are no ratings or popularity claims. These are design examples only; nothing is reserved, translated, sent, or charged.
- Worldwide traveler and guide interest forms, including home region/destination and languages, opened only after the backend readiness endpoint reports that launch is configured.
- Same-origin server-side input validation, strict field allow-list, required consent, size cap, hidden honeypot, rate limiting (5 submissions/IP hash/15 minutes), deduplication, and generic provider-error responses.
- Interest information is stored only in Cloudflare D1. The source IP is HMAC-hashed with a secret before its rate-limit fingerprint is stored; the raw IP is not saved by this function.
- Privacy and terms drafts are explicitly marked incomplete. The API remains closed until the launch flags and company/provider settings are configured.
- A second D1 migration defines user/session/OTP-challenge records, guide profiles with external identity-verification references only, experiences, availability, bookings, completion-code challenges, cash status, audit events, and safety reports.
- Pages Function API prototypes exist for email/phone OTP sign-in, session/logout, guide profiles and experiences, guide availability, public guide discovery, bookings, completion-code checks, cash status, safety reports, and admin review. These APIs are untested and unavailable unless explicit production, legal, secret, and provider gates are configured. They are not wired to the portal walkthroughs.

## Preview locally

Opening `public/index.html` directly shows the public site, but its API-backed forms remain unavailable outside a Pages deployment/local Pages runtime. Browser preview is not a launch or form-submission test.

To run Cloudflare Pages Functions locally, install a supported Node.js LTS release and Wrangler on your own machine, create a development D1 database, apply the migration, copy `.dev.vars.example` to `.dev.vars`, and keep all launch flags `false` until the legal and provider checklist below is complete. Never put real keys in a committed file.

## Deploy a preview on Cloudflare Pages

1. The source is already available in the GitHub repository's `main` branch. Do not force-push or replace its history.
2. Create a Cloudflare account, connect the repository through the Cloudflare dashboard's normal GitHub authorization, and create a Pages project. Use `public` as the build output directory and leave the build command empty. Cloudflare Pages Functions in `functions/` are deployed with the site.
3. Create a D1 database and apply [`migrations/0001_initial.sql`](./migrations/0001_initial.sql), then [`migrations/0002_marketplace_foundation.sql`](./migrations/0002_marketplace_foundation.sql), using the Cloudflare dashboard's D1 console or Wrangler.
4. Bind the D1 database to the Pages project with the exact binding name `DB` in both preview and production. Redeploy after adding the binding.
5. Add the configuration variables from `.dev.vars.example` to the **production** Pages Functions environment only after replacing every placeholder and reviewing the checklist below. Keep all launch switches `false` initially. Never add `.dev.vars` to Git.
6. Open the `*.pages.dev` preview, verify both interest-form variants end to end using a test address, verify D1 inserts/duplicates/rate limits, inspect security headers, and verify a preview rollback before connecting a custom domain.
7. After company/contact details and reviewed notices are published, set `LAUNCH_PRIVACY_NOTICE_APPROVED=true`, `LAUNCH_TERMS_APPROVED=true`, and `PUBLIC_LAUNCH_ENABLED=true`, redeploy, and confirm the readiness endpoint and a fresh test entry.
8. Add the domain in the Cloudflare Pages project and follow the dashboard's DNS/TLS instructions. Configure a second owner with MFA and least privilege; do not share passwords or recovery codes.

The repository is not yet connected to a Cloudflare Pages project, and no live Pages Functions or D1 deployment has been verified. The account owner must create provider resources and authorize deployment through the authenticated provider dashboard. The API migration and handlers have not been tested against a live Cloudflare runtime.

## Vercel static preview

`vercel.json` points Vercel at `public/` for a **static preview only**. The project’s Pages Functions in `functions/` require Cloudflare Pages and D1; they do not become working Vercel API routes. Sign-in, guides, bookings, safety reports, and interest-form API submissions will not work on a Vercel static deployment. Do not configure this as the live marketplace.

Vercel's current [Terms of Service](https://vercel.com/legal/terms) state that its free Hobby plan is for personal or non-commercial use. heymyGuide is a business, so do not deploy it for commercial use on Hobby. Use a Vercel plan whose terms permit the business, or choose an appropriate alternative. Account authorization, project import, settings, and deployment must be completed from the owner's authenticated provider dashboard.

## Marketplace backend prototype status

The API and schema are implementation groundwork, not a complete or tested backend. The public health endpoint intentionally always reports `marketplaceEnabled: false`. Marketplace routes fail closed unless the D1 binding, launch/legal approvals, HMAC secrets, and feature gates are configured. Setting example values to `true` does not make the product safe or production-ready.

The current routes cover basic OTP delivery/verification (Resend email and Twilio SMS), sessions/roles, owner-email admin bootstrap, guide profiles/experiences, guide availability, guide discovery, booking request/accept/decline/start/cancel, trip-completion OTP, direct-cash status, reports and admin review. No database migration or end-to-end API flow has been run in D1. The current guide ID review is a manual admin status/reference field; there is no identity-provider API, callback, or evidence that a reference is genuine. Do not approve guides until a lawful provider workflow is configured and independently verified.

There is no real marketplace UI wired to these routes, chat or translation, profile-photo upload/storage, guide ratings/reviews, complete legal/cancellation/support operations, alerting, or production monitoring. The existing portals remain illustrative. Email-only travelers cannot request a booking until their account has a verified phone; there is not yet a phone-linking flow in the UI. Guide identity documents are deliberately not stored in D1. A guide's cash-received report is not proof of payment; no funds are held or settled by the platform. The completion code must be entered privately by the traveler and never disclosed to the guide.

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

Keep the intake switches off if any item is missing. The readiness route checks configuration presence, not a real database transaction or the legal adequacy of the notices. A successful readiness response is not a legal or security approval.

## India launch and business checklist

This is an engineering checklist, not legal, tax, employment, insurance, or regulatory advice. Ask India-qualified counsel and a chartered accountant to review the specific company, contracts, marketplace role, regions served, pricing, and payment flow before taking bookings.

- Replace all bracketed fields in [`public/privacy.html`](./public/privacy.html) and [`public/terms.html`](./public/terms.html); confirm the displayed entity, notice version, purposes, processor/subprocessor list, accurate data-processing location/transfer disclosures, retention, withdrawal/deletion channel, and grievance route. Remove their `noindex` directives only after approval.
- Confirm applicability and commencement/transition rules for the Digital Personal Data Protection Act, 2023 and rules in force, consumer/e-commerce disclosures, IT/security incident duties, and the entity's grievance and record-keeping obligations. Publish only reviewed, accurate notices.
- Confirm GST registration, invoicing, TCS/marketplace/operator treatment, guide classification, labour/contract status, local tourism permissions, insurance/liability, and consumer cancellation/refund obligations with counsel/CA. Applicability depends on how the service is actually structured.
- Choose processors after privacy/security, contract, pricing and data-region review. Free-tier usage has quota limits and provider-specific terms. Cloudflare Pages/Workers/D1 are hosted commercial services, not all-open-source software; this site code has no package dependencies, but hosting is not self-hosted.
- D1 placement and provider access/transfer details must be checked and accurately disclosed. Do not infer that information stays in India. If the required storage/transfer posture is not acceptable, choose a provider/plan/architecture with the needed regional controls before collecting addresses.
- The retention period is not automatic. Review and manually run an approved deletion procedure at least monthly; delete withdrawn/expired interest only under the published schedule and any legal hold. D1 access is admin-level, so enable MFA and tightly restrict access. Never share exports in chat.
- The intake also prunes entries older than 180 days on a subsequent submission. For a quiet site, manually run `DELETE FROM heymyguide_leads WHERE created_at < datetime('now', '-180 days');` at least monthly so inactivity does not extend retention.
- Test accessibility, keyboard/screen-reader flows, email deliverability, abuse controls, data deletion, backups/restore, incident response, and rollback. Free plans do not supply a zero-downtime guarantee or an enterprise SLA. Monitor quotas and alerts.

The waitlist is only a way to ask permission to contact someone about their interest. It does not provide double-opt-in email verification, and the address is not proof of identity. No one should send ID, OTP, payment, health, or other sensitive information through it.

## Portal walkthrough status

The three portal buttons open illustrative walkthroughs:

- **Traveler:** example guide, sample availability, a proposed pay-cash-to-guide-after-trip method, and an online payment placeholder. There is no live guide offer or cash/online transaction. A cash-only marketplace still needs a reviewed policy for guide compensation, platform fees, receipts, cancellations, refunds, disputes, safety, and applicable regional rules.
- **Traveler location picker:** cascades through country, state/province/region and city for the sample destination catalog; “Other” lets users enter a location manually. The results prioritize exact city, then region, then country matches; they are not ratings-based. The bundled sample is not a comprehensive global location database, and its fictional guide cards are not bookable.
- **Guide:** sample profile, editable example daily fee/currency, guide-local availability controls and illustrative cash earnings. The saved sample fee is held in page memory and updates the matching sample traveler profile; it is not persisted to an account or published. Changing a sample slot changes only its display; it is not saved and cannot prevent double bookings. Cash paid directly to a guide is not confirmed or guaranteed by this prototype.
- **Admin:** sample zero-count operations dashboard and a launch checklist. It has no sign-in, moderation actions, customer data or staff authorization.

The chat language selector does not translate or send messages. A translation provider must be selected and privacy-reviewed. The trip-completion copy describes a future flow where the traveler enters the completion OTP in the authenticated service; travelers must never share that code with the guide. Phone verification/SMS is not configured.

These walkthroughs do not make the product production-ready. Before any real marketplace use, implement and independently test authentication and role-based access, guide onboarding and lawful verification, persistent availability/booking with concurrency controls and cancellation, secure messaging/reporting, SMS OTP with rate limits and expiry, cash and later online-payment operations, admin audit logging, privacy/legal review, and customer support. Keep public intake and all transactions disabled until those prerequisites are deployed and verified.

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
