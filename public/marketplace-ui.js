(() => {
  const modalRoot = () => document.querySelector("#modal-root");
  let activeRole = "";
  let activeChannel = "email";
  let challenge = null;
  let phoneChallenge = null;
  let user = null;
  let marketplaceEnabled = false;

  const roles = {
    traveler: { title: "Traveler portal", label: "Traveler", channel: "email" },
    guide: { title: "Guide portal", label: "Local guide", channel: "phone" },
    admin: { title: "Admin portal", label: "Admin", channel: "email" },
  };

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  async function api(path, method = "GET", payload) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: payload === undefined ? { Accept: "application/json" } : {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "The request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function setStatus(message, kind = "info", root = modalRoot()) {
    const status = root?.querySelector("[data-portal-status]");
    if (!status) return;
    status.textContent = message;
    status.className = `form-status ${kind}`;
  }

  function show(title, subtitle, content) {
    const root = modalRoot();
    if (!root) return;
    root.innerHTML = `<div class="modal-backdrop" data-portal-action="backdrop"><section class="modal portal-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-portal-action="close" aria-label="Close dialog">×</button><h2 id="modal-title">${escape(title)}</h2><p class="modal-subtitle">${escape(subtitle)}</p>${content}</section></div>`;
  }

  function formatFee(minor, currency) {
    try {
      const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(minor) / (10 ** digits));
    } catch {
      return `${currency} ${minor}`;
    }
  }

  function readinessBanner() {
    return marketplaceEnabled ? "" : `<div class="readiness-card"><div><strong>Marketplace is not enabled.</strong><p>Sign-in and booking are protected by server-side configuration. No demo OTP or fake account can access customer data.</p></div></div>`;
  }

  function signInView(role, message = "") {
    const config = roles[role];
    const channel = role === "traveler" ? activeChannel : config.channel;
    const usePhone = channel === "phone";
    const channelPicker = role === "traveler"
      ? `<label class="form-group">Sign-in method<select name="channel" data-channel-select><option value="email" ${channel === "email" ? "selected" : ""}>Email</option><option value="phone" ${channel === "phone" ? "selected" : ""}>Phone</option></select></label>`
      : "";
    const field = usePhone
      ? `<label class="form-group">Mobile number <input name="contact" type="tel" inputmode="tel" autocomplete="tel" placeholder="+919876543210" pattern="\\+[1-9][0-9]{7,14}" required></label>`
      : `<label class="form-group">${role === "admin" ? "Owner email" : "Email address"} <input name="contact" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required></label>`;
    show(config.title, "Secure, passwordless sign-in. Verification codes are delivered only through a configured provider.", `${readinessBanner()}
      <form data-portal-form="request-otp" data-role="${role}">
        ${channelPicker}
        ${field}
        <p class="form-status ${message ? "error" : "info"}" data-portal-status role="status" aria-live="polite">${escape(message || (usePhone ? "Use international format, including country code." : role === "admin" ? "Admin access is restricted to the configured owner email." : "A verified phone number is required before requesting a guide.") )}</p>
        <button class="btn btn-primary" type="submit" ${marketplaceEnabled ? "" : "disabled"}>Send verification code</button>
      </form>`);
  }

  function codeView() {
    const config = roles[activeRole];
    show(config.title, `Enter the code sent to ${challenge.destination}. It expires in five minutes.`, `<form data-portal-form="verify-otp">
      <label class="form-group">Six-digit code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label>
      <p class="form-status info" data-portal-status role="status" aria-live="polite">Never share a sign-in code with anyone.</p>
      <button class="btn btn-primary" type="submit">Verify and sign in</button>
      <button class="btn btn-outline" type="button" data-portal-action="back-to-signin">Use a different contact</button>
    </form>`);
  }

  async function open(role) {
    if (!roles[role]) return;
    activeRole = role;
    activeChannel = roles[role].channel;
    challenge = null;
    try {
      const health = await api("/api/health");
      marketplaceEnabled = health.marketplaceEnabled === true;
    } catch {
      marketplaceEnabled = false;
    }
    if (!marketplaceEnabled) {
      signInView(role, "Real accounts and booking are unavailable until marketplace, legal, OTP, and verification prerequisites are configured.");
      return;
    }
    try {
      const result = await api("/api/auth/me");
      if (result.authenticated && result.user.role === role) {
        user = result.user;
        await dashboard();
        return;
      }
      if (result.authenticated) {
        signInView(role, "You are signed in to a different portal. Sign out first to switch roles.");
        return;
      }
    } catch (error) {
      if (error.status !== 401 && error.status !== 503) {
        signInView(role, error.message);
        return;
      }
      if (error.status === 503) {
        signInView(role, "The marketplace is not configured yet. The public pre-launch site remains available; account and booking data are not being accepted.");
        return;
      }
    }
    signInView(role);
  }

  function field(name, label, value = "", attrs = "") {
    return `<label class="form-group">${escape(label)}<input name="${escape(name)}" value="${escape(value)}" ${attrs}></label>`;
  }

  function bookingCard(booking) {
    const date = new Date(booking.startsAt);
    const status = escape(booking.status.replaceAll("_", " "));
    const controls = [];
    if (user.role === "guide" && booking.status === "requested") {
      controls.push(`<button class="btn btn-primary btn-small" data-portal-action="booking" data-booking-action="accept" data-booking-id="${escape(booking.id)}">Accept</button>`);
      controls.push(`<button class="btn btn-outline btn-small" data-portal-action="booking" data-booking-action="decline" data-booking-id="${escape(booking.id)}">Decline</button>`);
    }
    if (user.role === "guide" && booking.status === "confirmed") controls.push(`<button class="btn btn-primary btn-small" data-portal-action="booking" data-booking-action="start" data-booking-id="${escape(booking.id)}">Start trip</button>`);
    if (user.role === "guide" && ["in_progress", "completion_pending"].includes(booking.status)) {
      controls.push(`<button class="btn btn-outline btn-small" data-portal-action="booking" data-booking-action="request_completion_code" data-booking-id="${escape(booking.id)}">Send completion code</button>`);
    }
    if (user.role === "traveler" && booking.status === "completion_pending") {
      controls.push(`<form class="inline-action" data-portal-form="booking-code" data-booking-id="${escape(booking.id)}"><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code" required><button class="btn btn-primary btn-small" type="submit">Confirm completion</button></form>`);
    }
    if (["requested", "confirmed"].includes(booking.status)) controls.push(`<button class="btn btn-outline btn-small" data-portal-action="booking" data-booking-action="cancel" data-booking-id="${escape(booking.id)}">Cancel</button>`);
    if (user.role === "guide" && booking.status === "completed" && booking.cashStatus === "due") controls.push(`<button class="btn btn-outline btn-small" data-portal-action="booking" data-booking-action="report_cash_paid" data-booking-id="${escape(booking.id)}">Report cash received</button>`);
    if (user.role === "traveler" && booking.status === "completed" && ["due", "guide_reported_paid"].includes(booking.cashStatus)) {
      if (booking.cashStatus === "guide_reported_paid") controls.push(`<button class="btn btn-primary btn-small" data-portal-action="booking" data-booking-action="confirm_cash" data-booking-id="${escape(booking.id)}">Confirm cash received</button>`);
      controls.push(`<button class="btn btn-outline btn-small" data-portal-action="booking" data-booking-action="dispute_cash" data-booking-id="${escape(booking.id)}">Dispute cash status</button>`);
    }
    if (!["cancelled", "disputed"].includes(booking.status)) controls.push(`<button class="btn btn-outline btn-small" data-portal-action="report" data-booking-id="${escape(booking.id)}">Report an issue</button>`);
    return `<article class="portal-module booking-card"><div class="portal-module-heading"><div><span class="eyebrow">${escape(booking.guideName || "Guide")} · ${escape(booking.guideCity || "")}</span><h3>${escape(date.toLocaleString())}</h3></div><span class="badge badge-pending">${status}</span></div>
      <p>${booking.experience ? escape(booking.experience.title) : "Local guide service"} · ${escape(formatFee(booking.dailyFeeMinor, booking.currency))} · cash directly to guide</p>
      <p class="portal-inline-note">Trip expenses such as food, transport and accommodation are separate. heymyGuide does not hold or verify cash.</p>
      <div class="portal-actions">${controls.join("")}</div></article>`;
  }

  async function travelerDashboard() {
    const current = await api("/api/auth/me");
    const phoneVerified = current.user.phoneVerified;
    const bookings = await api("/api/bookings");
    return `<div class="portal-demo">
      <div class="portal-welcome"><div><span class="eyebrow">TRAVELER ACCOUNT</span><h3>Find a local guide.</h3><p>Only active, phone-verified, externally reviewed guides with open availability are listed.</p></div><span class="badge ${phoneVerified ? "badge-approved" : "badge-pending"}">${phoneVerified ? "Phone verified" : "Phone verification needed to book"}</span></div>
      ${!phoneVerified ? `<form class="portal-module" data-portal-form="link-phone-request"><div class="portal-module-heading"><h3>Verify your phone to book</h3></div><label class="form-group">Mobile number <input name="phone" type="tel" inputmode="tel" autocomplete="tel" pattern="\\+[1-9][0-9]{7,14}" placeholder="+919876543210" required></label><p class="portal-inline-note">A verified phone is used for trip completion confirmation. We will not display it to guides.</p><button class="btn btn-primary" type="submit">Send phone verification code</button></form>` : ""}
      <section class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">GUIDE SEARCH</span><h3>Search a destination</h3></div></div>
        <form data-portal-form="search-guides" class="location-select-grid">
          ${field("country", "Country code (2 letters)", "", 'maxlength="2" placeholder="IN" required')}
          ${field("region", "State / region", "", 'maxlength="120" placeholder="Jammu and Kashmir"')}
          ${field("city", "City", "", 'maxlength="120" placeholder="Srinagar"')}
          <button class="btn btn-primary" type="submit">Find verified guides</button>
        </form>
        <div data-guide-results aria-live="polite"><p class="portal-inline-note">Enter a location to search approved guide listings.</p></div>
      </section>
      <div class="portal-module-heading"><h3>Your bookings</h3><button class="btn btn-outline btn-small" data-portal-action="refresh">Refresh</button></div>
      <div data-bookings>${bookings.bookings.length ? bookings.bookings.map(bookingCard).join("") : `<p class="portal-inline-note">No bookings yet.</p>`}</div>
      <p class="form-status" data-portal-status role="status" aria-live="polite"></p>
      <button class="btn btn-outline" data-portal-action="signout">Sign out</button>
    </div>`;
  }

  async function guideDashboard() {
    const [profileResult, availabilityResult, experienceResult, bookingResult] = await Promise.all([
      api("/api/guide/profile"), api("/api/availability"), api("/api/guide/experiences"), api("/api/bookings"),
    ]);
    const profile = profileResult.profile || {};
    const fee = profile.dailyFeeMinor
      ? (() => {
        try {
          const digits = new Intl.NumberFormat("en", { style: "currency", currency: profile.currency }).resolvedOptions().maximumFractionDigits;
          return profile.dailyFeeMinor / (10 ** digits);
        } catch { return ""; }
      })()
      : "";
    return `<div class="portal-demo">
      <div class="portal-welcome"><div><span class="eyebrow">GUIDE ACCOUNT</span><h3>Build your local guide profile.</h3><p>Profiles stay private until a lawful identity check is completed and an admin approves the listing.</p></div><span class="badge badge-pending">${escape(profile.verificationStatus || "profile needed")}</span></div>
      <form class="portal-module" data-portal-form="save-profile"><div class="portal-module-heading"><h3>Your profile and daily fee</h3></div>
        ${field("displayName", "Name shown to travelers", profile.displayName, 'maxlength="100" required')}
        ${field("country", "Country", profile.country, 'maxlength="100" required')}
        <div class="location-select-grid">${field("countryCode", "Country code", profile.countryCode, 'maxlength="2" placeholder="IN" required')}${field("region", "State / region", profile.region, 'maxlength="120" required')}${field("city", "City", profile.city, 'maxlength="120" required')}${field("timezone", "IANA timezone", profile.timezone || "Asia/Kolkata", 'maxlength="80" placeholder="Asia/Kolkata" required')}</div>
        <label class="form-group">About your local experience <textarea name="bio" maxlength="2000" rows="4">${escape(profile.bio || "")}</textarea></label>
        ${field("languages", "Languages (comma-separated)", (profile.languages || []).join(", "), 'maxlength="1000" placeholder="Kashmiri, Hindi, English" required')}
        <div class="location-select-grid">${field("dailyFee", "Daily guide fee", fee, 'type="number" min="0.01" max="99999999" step="0.01" required')}
        <label class="form-group">Currency<select name="currency" required>${currencyOptions.map(([code, name]) => `<option value="${code}" ${profile.currency === code ? "selected" : ""}>${code} · ${escape(name)}</option>`).join("")}</select></label></div>
        <p class="portal-inline-note">Guide fee excludes travel expenses. Saving a profile does not make it public; review is required.</p><button class="btn btn-primary" type="submit">Save guide profile</button>
      </form>
      <form class="portal-module" data-portal-form="add-experience"><div class="portal-module-heading"><h3>Places and experiences</h3></div>
        ${field("title", "Experience title", "", 'maxlength="120" required')}
        <label class="form-group">Description and places covered <textarea name="description" minlength="1" maxlength="3000" rows="3" required></textarea></label>
        ${field("durationMinutes", "Duration in minutes", "360", 'type="number" min="30" max="1440" step="1" required')}
        <button class="btn btn-primary" type="submit">Add experience</button><div data-experiences>${experienceResult.experiences.map((item) => `<p>${escape(item.title)} · ${item.durationMinutes} min</p>`).join("")}</div>
      </form>
      <form class="portal-module" data-portal-form="add-availability"><div class="portal-module-heading"><h3>Offer a time slot</h3></div>
        <label class="form-group">Start<input name="startsAt" type="datetime-local" required></label><label class="form-group">End<input name="endsAt" type="datetime-local" required></label>
        <p class="portal-inline-note">Only approved and phone-verified guides can publish availability.</p><button class="btn btn-primary" type="submit">Add availability</button>
        <div data-availability>${availabilityResult.availability.map((slot) => `<p>${escape(new Date(slot.startsAt).toLocaleString())}–${escape(new Date(slot.endsAt).toLocaleTimeString())} · ${escape(slot.status)} ${slot.status === "open" ? `<button class="btn btn-outline btn-small" data-portal-action="remove-slot" data-slot-id="${escape(slot.id)}">Remove</button>` : ""}</p>`).join("") || "<p>No future slots.</p>"}</div>
      </form>
      <div class="portal-module-heading"><h3>Booking requests and trips</h3><button class="btn btn-outline btn-small" data-portal-action="refresh">Refresh</button></div>
      <div data-bookings>${bookingResult.bookings.length ? bookingResult.bookings.map(bookingCard).join("") : `<p class="portal-inline-note">No bookings yet.</p>`}</div>
      <p class="form-status" data-portal-status role="status" aria-live="polite"></p><button class="btn btn-outline" data-portal-action="signout">Sign out</button>
    </div>`;
  }

  async function adminDashboard() {
    const data = await api("/api/admin");
    const counts = (data.counts?.users || []).map((item) => `${escape(item.role)} · ${escape(item.status)}: ${item.count}`).join(" · ");
    const reports = (data.openReports || []).map((report) => `<article class="portal-module"><strong>${escape(report.category)}</strong><p>Report ${escape(report.id)} · ${escape(report.status)}</p><div class="portal-actions"><button class="btn btn-outline btn-small" data-portal-action="review-report" data-report-id="${escape(report.id)}" data-status="reviewing">Mark reviewing</button><button class="btn btn-primary btn-small" data-portal-action="review-report" data-report-id="${escape(report.id)}" data-status="resolved">Resolve</button></div></article>`).join("") || `<p class="portal-inline-note">No open reports.</p>`;
    const guides = (data.pendingGuideReviews || []).map((guide) => `<article class="portal-module"><strong>${escape(guide.display_name)}</strong><p>${escape([guide.city, guide.region, guide.country_name].filter(Boolean).join(", "))} · ${escape(guide.verification_status)}</p>
      <form data-portal-form="review-guide" data-guide-id="${escape(guide.user_id)}">
        <label class="form-group">Review result<select name="status"><option value="approved">Approve after external ID check</option><option value="rejected">Reject</option><option value="suspended">Suspend</option></select></label>
        <label class="form-group">Verification provider reference (required for approval)<input name="verificationReference" maxlength="200"></label>
        <label class="consent-row"><input name="publicListing" type="checkbox"><span>Publish guide after approval and phone verification.</span></label>
        <p class="portal-inline-note">Complete and document identity review with the configured provider before approval. The app does not collect or verify ID documents.</p>
        <button class="btn btn-primary" type="submit">Save review</button>
      </form></article>`).join("") || `<p class="portal-inline-note">No guide profiles awaiting review.</p>`;
    return `<div class="portal-demo"><div class="portal-welcome"><div><span class="eyebrow">AUTHORIZED STAFF</span><h3>Community operations.</h3><p>Access is recorded through admin audit events.</p></div><span class="badge badge-review">Admin</span></div>
      <section class="portal-module"><div class="portal-module-heading"><h3>Marketplace totals</h3><button class="btn btn-outline btn-small" data-portal-action="refresh">Refresh</button></div><p>${counts || "No account data."}</p>
        <p>Guide profiles: ${escape(JSON.stringify(data.counts?.guides || []))}</p><p>Bookings: ${escape(JSON.stringify(data.counts?.bookings || []))}</p><p>Reports: ${escape(JSON.stringify(data.counts?.reports || []))}</p></section>
      <section class="portal-module"><h3>Pending guide review</h3>${guides}</section>
      <section class="portal-module"><h3>Open safety reports</h3>${reports}</section>
      <p class="form-status" data-portal-status role="status" aria-live="polite"></p><button class="btn btn-outline" data-portal-action="signout">Sign out</button>
    </div>`;
  }

  async function dashboard() {
    try {
      const config = roles[user?.role || activeRole];
      if (!config) return signInView(activeRole);
      const content = user.role === "traveler"
        ? await travelerDashboard()
        : user.role === "guide"
          ? await guideDashboard()
          : await adminDashboard();
      show(config.title, `${user.role === "admin" ? "Staff-only controls." : "Your account data is private to you."}`, content);
    } catch (error) {
      show(roles[activeRole].title, "Your account could not be loaded.", `<div class="readiness-card"><div><strong>${escape(error.message)}</strong><p>Nothing was changed. Retry after the service is available.</p></div></div><button class="btn btn-outline" data-portal-action="refresh">Retry</button><button class="btn btn-outline" data-portal-action="signout">Sign out</button>`);
    }
  }

  async function handleSubmit(event) {
    const form = event.target;
    const portalForm = form.dataset.portalForm;
    if (!portalForm) return false;
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const values = new FormData(form);
      if (portalForm === "request-otp") {
        activeRole = form.dataset.role;
        const channel = activeRole === "traveler" ? String(values.get("channel") || "email") : roles[activeRole].channel;
        activeChannel = channel;
        const result = await api("/api/auth/request", "POST", {
          role: activeRole,
          channel,
          [channel]: String(values.get("contact") || "").trim(),
        });
        challenge = { id: result.challengeId, destination: String(values.get("contact") || "").trim() };
        codeView();
      } else if (portalForm === "verify-otp") {
        await api("/api/auth/verify", "POST", { challengeId: challenge?.id, code: String(values.get("code") || "").trim() });
        const result = await api("/api/auth/me");
        user = result.user;
        await dashboard();
      } else if (portalForm === "link-phone-request") {
        const result = await api("/api/auth/phone", "POST", { action: "request", phone: String(values.get("phone") || "").trim() });
        phoneChallenge = { id: result.challengeId, phone: String(values.get("phone") || "").trim() };
        show(roles.traveler.title, `Enter the code sent to ${phoneChallenge.phone}. It expires in five minutes.`, `<form data-portal-form="link-phone-verify">
          <label class="form-group">Six-digit code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
          <p class="form-status info" data-portal-status role="status">Never share this code with anyone.</p>
          <button class="btn btn-primary" type="submit">Verify phone</button><button class="btn btn-outline" type="button" data-portal-action="refresh">Cancel</button>
        </form>`);
      } else if (portalForm === "link-phone-verify") {
        await api("/api/auth/phone", "POST", { action: "verify", challengeId: phoneChallenge?.id, code: String(values.get("code") || "").trim() });
        phoneChallenge = null;
        const result = await api("/api/auth/me");
        user = result.user;
        await dashboard();
      } else if (portalForm === "search-guides") {
        const params = new URLSearchParams();
        for (const key of ["country", "region", "city"]) {
          const value = String(values.get(key) || "").trim();
          if (value) params.set(key, value);
        }
        const result = await api(`/api/guides?${params}`);
        const output = modalRoot().querySelector("[data-guide-results]");
        output.innerHTML = result.guides.length ? `<div class="local-guide-grid">${result.guides.map((guide) => `<article class="local-guide-result"><span class="badge badge-approved">Verified guide</span><h4>${escape(guide.displayName)}</h4><p>${escape([guide.city, guide.region, guide.country].filter(Boolean).join(", "))}</p><p>${escape(guide.bio)}</p><p><strong>Languages:</strong> ${escape(guide.languages.join(", "))}</p><p><strong>Guide fee per day:</strong> ${escape(formatFee(guide.dailyFeeMinor, guide.currency))}</p>
          ${guide.experiences.length ? `<label class="form-group">Experience<select data-experience-for="${escape(guide.id)}"><option value="">Flexible plan</option>${guide.experiences.map((item) => `<option value="${escape(item.id)}">${escape(item.title)} · ${item.durationMinutes} min</option>`).join("")}</select></label>` : ""}
          <label class="form-group">Available slot<select data-slot-for="${escape(guide.id)}"><option value="">Choose a slot</option>${guide.availability.map((slot) => `<option value="${escape(slot.id)}">${escape(new Date(slot.startsAt).toLocaleString())}–${escape(new Date(slot.endsAt).toLocaleTimeString())}</option>`).join("")}</select></label>
          <button class="btn btn-primary btn-small" data-portal-action="book-guide" data-guide-id="${escape(guide.id)}">Request this guide</button></article>`).join("")}</div>` : `<p class="portal-inline-note">No approved guides with open availability match that location yet.</p>`;
        setStatus(`${result.guides.length} guide profile(s) found.`);
      } else if (portalForm === "save-profile") {
        const profile = {
          displayName: values.get("displayName"), countryCode: values.get("countryCode"), country: values.get("country"),
          region: values.get("region"), city: values.get("city"), timezone: values.get("timezone"), bio: values.get("bio") || "",
          languages: String(values.get("languages") || "").split(",").map((item) => item.trim()).filter(Boolean),
          dailyFee: Number(values.get("dailyFee")), currency: values.get("currency"),
        };
        const result = await api("/api/guide/profile", "PUT", profile);
        setStatus(`Profile saved. Verification status: ${result.profile.verificationStatus}; public listing: ${result.profile.publicListing ? "on" : "off"}.`);
      } else if (portalForm === "add-experience") {
        await api("/api/guide/experiences", "POST", { title: values.get("title"), description: values.get("description"), durationMinutes: Number(values.get("durationMinutes")) });
        await dashboard();
      } else if (portalForm === "add-availability") {
        const startsAt = new Date(values.get("startsAt")).toISOString();
        const endsAt = new Date(values.get("endsAt")).toISOString();
        await api("/api/availability", "POST", { startsAt, endsAt });
        await dashboard();
      } else if (portalForm === "booking-code") {
        await api("/api/bookings", "PATCH", { bookingId: form.dataset.bookingId, action: "confirm_completion", code: String(values.get("code") || "").trim() });
        await dashboard();
      } else if (portalForm === "report") {
        await api("/api/reports", "POST", { bookingId: form.dataset.bookingId, category: values.get("category"), description: values.get("description") });
        await dashboard();
      } else if (portalForm === "review-guide") {
        await api("/api/admin", "PATCH", {
          action: "review_guide",
          guideId: form.dataset.guideId,
          status: values.get("status"),
          verificationReference: values.get("verificationReference"),
          publicListing: values.get("publicListing") === "on",
        });
        await dashboard();
      }
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      if (submit?.isConnected) submit.disabled = false;
    }
    return true;
  }

  async function handleAction(event, target) {
    const action = target.dataset.portalAction;
    if (!action) return false;
    if (action === "backdrop" && event.target !== target) return true;
    event.preventDefault();
    if (action === "close") {
      modalRoot().innerHTML = "";
      return true;
    }
    if (action === "back-to-signin") {
      challenge = null;
      signInView(activeRole);
      return true;
    }
    if (action === "signout") {
      try { await api("/api/auth/logout", "POST", {}); } catch { /* The cookie may already be expired. */ }
      user = null;
      challenge = null;
      signInView(activeRole, "Signed out.");
      return true;
    }
    if (action === "refresh") {
      phoneChallenge = null;
      await dashboard();
      return true;
    }
    try {
      if (action === "book-guide") {
        const guideId = target.dataset.guideId;
        const slot = modalRoot().querySelector(`[data-slot-for="${CSS.escape(guideId)}"]`)?.value;
        const experience = modalRoot().querySelector(`[data-experience-for="${CSS.escape(guideId)}"]`)?.value || null;
        if (!slot) throw new Error("Choose an availability slot first.");
        const result = await api("/api/bookings", "POST", { availabilityId: slot, experienceId: experience });
        setStatus(result.message || "Booking request sent.");
        await dashboard();
      } else if (action === "booking") {
        const result = await api("/api/bookings", "PATCH", { bookingId: target.dataset.bookingId, action: target.dataset.bookingAction });
        setStatus(result.message || "Booking updated.");
        await dashboard();
      } else if (action === "remove-slot") {
        await api(`/api/availability?id=${encodeURIComponent(target.dataset.slotId)}`, "DELETE", {});
        await dashboard();
      } else if (action === "report") {
        show(roles[activeRole].title, "Report a booking-related concern to the moderation queue.", `<form data-portal-form="report" data-booking-id="${escape(target.dataset.bookingId)}">
          <label class="form-group">Issue type<select name="category"><option value="safety">Safety concern</option><option value="misconduct">Misconduct</option><option value="payment">Payment issue</option><option value="no_show">No show</option><option value="other">Other</option></select></label>
          <label class="form-group">What happened?<textarea name="description" minlength="10" maxlength="3000" required></textarea></label>
          <p class="form-status info" data-portal-status role="status">Not an emergency service. Contact local emergency services if anyone is in immediate danger.</p>
          <button class="btn btn-primary" type="submit">Submit report</button></form>`);
      } else if (action === "review-report") {
        const status = target.dataset.status;
        const resolutionNote = status === "reviewing" ? undefined : window.prompt("Add an internal resolution note (at least 5 characters):");
        if (status !== "reviewing" && (!resolutionNote || resolutionNote.trim().length < 5)) return true;
        await api("/api/admin", "PATCH", { action: "review_report", reportId: target.dataset.reportId, status, resolutionNote });
        await dashboard();
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
    return true;
  }

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-channel-select]")) {
      activeChannel = event.target.value === "phone" ? "phone" : "email";
      signInView(activeRole);
    }
  });
  document.addEventListener("submit", (event) => {
    if (event.target.matches("[data-portal-form]")) void handleSubmit(event);
  });
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-portal-action]");
    if (target) void handleAction(event, target);
  });

  window.heymyGuidePortal = { open, handleSubmit, handleAction };
})();
