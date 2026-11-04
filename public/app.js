const icon = (name, size = 18) => {
  const paths = {
    pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.check}</svg>`;
};

const places = [
  {
    id: "kashmir",
    title: "Kashmir, at your own pace",
    location: "Srinagar · Gulmarg · Pahalgam",
    description: "Neighbourhoods, houseboats, mountain air and the everyday places that make Kashmir feel like home.",
    tag: "Our first region",
  },
  {
    id: "belgaum",
    title: "Belgaum, beyond the map",
    location: "Karnataka · Maharashtra border",
    description: "A familiar hometown can still surprise you: local food, green escapes and stories worth sharing.",
    tag: "A local starting point",
  },
  {
    id: "ladakh",
    title: "A world of local places",
    location: "Ladakh · Nairobi · Kyoto · anywhere",
    description: "Wherever people call home, local knowledge can make a journey more human.",
    tag: "Growing thoughtfully",
  },
];

const demoLocations = [
  { country: "India", region: "Jammu and Kashmir", city: "Srinagar", guide: "Local host · example", currency: "INR", fee: "₹2,500", experience: "Old-city lanes, lakeside life and Kashmiri food stories." },
  { country: "India", region: "Karnataka", city: "Belagavi", guide: "Local host · example", currency: "INR", fee: "₹1,800", experience: "Market walks, local snacks and quiet green escapes." },
  { country: "Japan", region: "Kyoto Prefecture", city: "Kyoto", guide: "Local host · example", currency: "JPY", fee: "¥12,000", experience: "Neighbourhood shrines, craft streets and everyday Kyoto." },
  { country: "Kenya", region: "Nairobi County", city: "Nairobi", guide: "Local host · example", currency: "KES", fee: "KSh 5,000", experience: "City markets, local cafés and community stories." },
  { country: "France", region: "Île-de-France", city: "Paris", guide: "Local host · example", currency: "EUR", fee: "€90", experience: "Village-like streets, bakeries and neighborhood history." },
  { country: "United States", region: "California", city: "San Francisco", guide: "Local host · example", currency: "USD", fee: "$120", experience: "Public-transit routes, local food and waterfront views." },
];

const demoGuideProfiles = demoLocations.flatMap((location, index) => [
  {
    ...location,
    profileId: `example-guide-${index * 2 + 1}`,
    guide: `Example local guide ${index * 2 + 1}`,
    languages: "English · local language",
    experience: `${location.experience} Small-group pace and local stories.`,
  },
  {
    ...location,
    profileId: `example-guide-${index * 2 + 2}`,
    guide: `Example local guide ${index * 2 + 2}`,
    languages: "Local language · English",
    experience: `A relaxed neighborhood route in ${location.city}, with stops chosen together.`,
  },
]);

const guideRatePreview = { profileId: "example-guide-1", amount: "2500", currency: "INR" };
const currencyOptions = [
  ["INR", "Indian rupee"], ["USD", "US dollar"], ["EUR", "Euro"], ["GBP", "British pound"],
  ["JPY", "Japanese yen"], ["KES", "Kenyan shilling"], ["AUD", "Australian dollar"],
  ["CAD", "Canadian dollar"], ["AED", "UAE dirham"],
];

const app = document.querySelector("#app");
let launchReady = false;
let toastTimer;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatDemoRate(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

function header() {
  return `<header class="topbar">
    <a class="brand" href="#" data-action="home" aria-label="heymyGuide home"><span class="brand-mark">h</span><span>heymy<em>Guide</em></span></a>
    <nav class="top-nav" aria-label="Main navigation">
      <a href="#places">Places</a><a href="#how-it-works">How it works</a><a href="#portals">Portals</a>
    </nav>
    <div class="top-actions"><button class="btn btn-quiet" data-action="traveler-interest">I'm planning a trip</button><button class="btn btn-primary" data-action="guide-interest">I'm a local guide</button></div>
  </header>`;
}

function footer() {
  return `<footer class="footer"><div class="container footer-inner">
    <a class="brand" href="#" data-action="home"><span class="brand-mark">h</span><span>heymy<em>Guide</em></span></a>
    <span class="footer-note">Local knowledge. Thoughtful travel. Fair pay.</span>
    <div class="footer-links"><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><span id="support-contact">Contact details publishing soon</span></div>
    <span>© ${new Date().getFullYear()} heymyGuide</span>
  </div></footer>`;
}

function placeCard(place, index) {
  return `<article class="place-card">
    <div class="place-cover place-cover-${place.id}">
      <span class="card-tag">${escapeHTML(place.tag)}</span>
      <span class="place-cover-caption">${icon("pin", 13)} ${escapeHTML(place.location)}</span>
    </div>
    <div class="place-card-body"><span class="eyebrow">0${index + 1} · Discover slowly</span><h3>${escapeHTML(place.title)}</h3><p>${escapeHTML(place.description)}</p><button class="text-link" data-action="traveler-interest" data-destination="${escapeHTML(place.title.split(",")[0])}">Get launch updates ${icon("arrow", 14)}</button></div>
  </article>`;
}

function travelerLocationPicker() {
  const countries = [...new Set(demoLocations.map((location) => location.country))];
  return `<section class="portal-module location-picker"><div class="portal-module-heading"><div><span class="eyebrow">FIND LOCAL EXPERIENCES</span><h3>Where would you like to explore?</h3></div><span class="badge badge-review">Sample directory</span></div>
    <p class="portal-copy">Choose a country, state/province/region, then city. Or enter a place manually. Matching example profiles update with your search; all are fictional previews, not available listings.</p>
    <div class="location-select-grid">
      <label>Country<select name="country" data-location-level="country"><option value="">Select a country</option>${countries.map((country) => `<option>${escapeHTML(country)}</option>`).join("")}<option value="other">Other country</option></select><input name="countryOther" class="location-other" placeholder="Enter country" hidden></label>
      <label>State / province / region<select name="region" data-location-level="region" disabled><option value="">Select a region</option></select><input name="regionOther" class="location-other" placeholder="Enter state, province or region" hidden></label>
      <label>City<select name="city" data-location-level="city" disabled><option value="">Select a city</option></select><input name="cityOther" class="location-other" placeholder="Enter city or town" hidden></label>
    </div>
    <div class="directory-results" aria-live="polite"><p class="portal-inline-note">Select a country, region or city to see the closest matching illustrative guide profiles.</p></div>
  </section>`;
}

function updateLocationChoices(locationRoot, changedLevel) {
  const countrySelect = locationRoot.querySelector('[name="country"]');
  const regionSelect = locationRoot.querySelector('[name="region"]');
  const citySelect = locationRoot.querySelector('[name="city"]');
  const country = countrySelect.value;
  const region = regionSelect.value;
  const reset = (select, placeholder, options = []) => {
    select.innerHTML = `<option value="">${placeholder}</option>${options.map((value) => `<option>${escapeHTML(value)}</option>`).join("")}<option value="other">Other / enter manually</option>`;
    select.disabled = options.length === 0;
  };
  if (changedLevel === "country") {
    reset(regionSelect, "Select a region", [...new Set(demoLocations.filter((item) => item.country === country).map((item) => item.region))]);
    locationRoot.querySelector('[name="regionOther"]').hidden = true;
    reset(citySelect, "Select a city");
    locationRoot.querySelector('[name="cityOther"]').hidden = true;
  } else if (changedLevel === "region") {
    reset(citySelect, "Select a city", [...new Set(demoLocations.filter((item) => item.country === country && item.region === region).map((item) => item.city))]);
    locationRoot.querySelector('[name="cityOther"]').hidden = true;
  }

  const countryOther = locationRoot.querySelector('[name="countryOther"]');
  countryOther.hidden = country !== "other";
  if (country === "other") {
    reset(regionSelect, "Select a region");
    reset(citySelect, "Select a city");
    locationRoot.querySelector('[name="regionOther"]').hidden = false;
    locationRoot.querySelector('[name="cityOther"]').hidden = false;
  } else if (region === "other") {
    locationRoot.querySelector('[name="regionOther"]').hidden = false;
    reset(citySelect, "Select a city");
    locationRoot.querySelector('[name="cityOther"]').hidden = false;
  } else if (citySelect.value === "other") {
    locationRoot.querySelector('[name="cityOther"]').hidden = false;
  }

  const selectedCountry = country === "other" ? locationRoot.querySelector('[name="countryOther"]').value.trim() : country;
  const selectedRegion = country === "other" || regionSelect.value === "other"
    ? locationRoot.querySelector('[name="regionOther"]').value.trim()
    : regionSelect.value;
  const selectedCity = country === "other" || regionSelect.value === "other" || citySelect.value === "other"
    ? locationRoot.querySelector('[name="cityOther"]').value.trim()
    : citySelect.value;
  const results = locationRoot.querySelector(".directory-results");
  const matches = selectedCountry
    ? demoGuideProfiles
      .filter((profile) => profile.country === selectedCountry
        && (!selectedRegion || profile.region === selectedRegion))
      .map((profile) => ({
        ...profile,
        matchLabel: selectedCity && profile.city === selectedCity
          ? "City match"
          : selectedRegion
            ? "Region match"
            : "Country match",
        rank: selectedCity && profile.city === selectedCity ? 0 : selectedRegion ? 1 : 2,
      }))
      .sort((a, b) => a.rank - b.rank || a.city.localeCompare(b.city) || a.guide.localeCompare(b.guide))
    : [];
  if (matches.length) {
    const searchPlace = [selectedCity, selectedRegion, selectedCountry].filter(Boolean).join(", ");
    results.innerHTML = `<div class="directory-heading"><div><span class="eyebrow">BEST LOCATION MATCHES</span><h4>Local guide profiles near ${escapeHTML(searchPlace)}</h4></div><span class="badge badge-review">Example profiles · no ratings</span></div><div class="local-guide-grid">${matches.map((profile) => {
      const isEditableExample = profile.profileId === guideRatePreview.profileId;
      const fee = isEditableExample ? formatDemoRate(guideRatePreview.amount, guideRatePreview.currency) : profile.fee;
      const currency = isEditableExample ? guideRatePreview.currency : profile.currency;
      return `<article class="local-guide-result"><span class="badge badge-review">${escapeHTML(profile.matchLabel)} · sample</span><h4>${escapeHTML(profile.guide)}</h4><p class="local-guide-location">${escapeHTML(profile.city)}, ${escapeHTML(profile.region)}, ${escapeHTML(profile.country)}</p><p>${escapeHTML(profile.experience)}</p><p class="local-guide-languages"><strong>Languages:</strong> ${escapeHTML(profile.languages)}</p><div class="guide-earnings-preview"><span>Guide fee / day</span><strong>${escapeHTML(fee)} <small>${escapeHTML(currency)} · sample</small></strong></div></article>`;
    }).join("")}</div><p class="portal-inline-note">Profiles are sorted by location match, not reviews or popularity. Sample guide fees are illustrative and not offers. In a future cash option, travelers would pay guides directly; heymyGuide cannot confirm or guarantee payment in this preview.</p>`;
  } else if (selectedCountry || selectedRegion || selectedCity) {
    results.innerHTML = `<p class="portal-inline-note">No sample guide profiles match this location yet. A live directory would show eligible, reviewed local guides when available. This preview has no real listings.</p>`;
  } else {
    results.innerHTML = `<p class="portal-inline-note">Select a country, region or city to see the closest matching illustrative guide profiles.</p>`;
  }
}

function customerHome() {
  return `<main class="page">
    <section class="hero"><div class="container hero-grid">
      <div class="hero-copy"><span class="eyebrow">A local host, wherever you land</span>
        <h1>See the world through a <span>local's eyes.</span></h1>
        <p>Find people who call a place home. Share a meal, hear the stories and discover the everyday corners that make a trip yours.</p>
        <div class="hero-points"><span>${icon("check", 15)} Local perspectives across languages</span><span>${icon("check", 15)} Clear day rates, trip costs separate</span></div>
        <div class="hero-actions"><button class="btn btn-primary" data-action="traveler-interest">Get traveler launch updates ${icon("arrow", 15)}</button><a class="btn btn-outline" href="#places">Explore our first places</a></div>
        <p class="hero-disclaimer">Starting with local communities everywhere. This preview doesn't take bookings or payments.</p>
      </div>
      <div class="hero-visual"><div class="hero-photo"></div>
        <div class="launch-badge">${icon("pin", 15)} From Kashmir to anywhere</div>
        <div class="hero-note"><img class="host-avatar" src="images/guide-preview.svg" alt=""><div><span class="preview-label">ILLUSTRATIVE PROFILE</span><strong>Your face. Your hometown.</strong><small>Photo, local knowledge & languages</small></div></div>
      </div>
    </div></section>
    <div class="container trust-row">${icon("shield")} <strong>Launching carefully</strong><span>·</span><span>Worldwide local community</span><span>·</span><span>No surprise trip expenses</span></div>
    <section class="container guide-section profile-section" id="guide-preview">
      <div class="section-heading"><div><span class="eyebrow">A person, not a package</span><h2>Every local has a story.</h2><p>When guides join, their first impression should tell travelers who they are and what a day together really costs.</p></div></div>
      <article class="profile-preview-card">
        <div class="profile-preview-photo"><img src="images/guide-preview.svg" alt="Illustration used for an example guide profile"><span>Example profile · not a real guide</span></div>
        <div class="profile-preview-copy">
          <div class="profile-preview-title"><div><span class="eyebrow">YOUR HOMETOWN · YOUR COUNTRY</span><h3>Your name, in your own words.</h3></div><span class="badge badge-review">Illustration</span></div>
          <p>Share a consented photo, the languages you speak, your local specialties and the places you can confidently guide.</p>
          <div class="profile-detail-grid"><div><strong>Languages</strong><span>Languages you speak</span></div><div><strong>Your guide fee</strong><span>Your rate / day · in local currency</span></div><div><strong>Your route</strong><span>Stops, duration & pace</span></div><div><strong>Trip expenses</strong><span>Transport, food & stay shown separately</span></div></div>
          <div class="expense-note">${icon("check", 15)} A guide can suggest local food, transport and accommodation. They are separate providers and costs; compare the price and details, then decide.</div>
          <button class="text-link" data-action="guide-interest">Help build your profile ${icon("arrow", 14)}</button>
        </div>
      </article>
    </section>
    <section class="container guide-section" id="places">
      <div class="section-heading"><div><span class="eyebrow">The places that feel like somewhere</span><h2>Start with curiosity.</h2><p>From our roots in Belgaum to Kashmir and wherever the community takes us. These are future destinations—not active listings.</p></div></div>
      <div class="place-grid">${places.map(placeCard).join("")}</div>
    </section>
    <section class="how-section" id="how-it-works"><div class="container">
      <div class="section-heading"><div><span class="eyebrow">A better kind of travel platform</span><h2>People connect across borders.</h2><p>A good trip respects the local's time as much as the traveler's budget.</p></div></div>
      <div class="steps">
        <article class="step-card"><div class="step-number">01</div><h3>Meet across languages</h3><p>We want to make it easier for travelers and guides to talk in the languages they know. Translation support is a future feature—not available in this preview.</p></article>
        <article class="step-card"><div class="step-number">02</div><h3>See the whole day</h3><p>Plan the route together. Keep the local guide fee clear and separate from food, transport, entry tickets and accommodation.</p></article>
        <article class="step-card"><div class="step-number">03</div><h3>Travel with care</h3><p>Safety checks, fair treatment, privacy and a clear way to ask for help must come before bookings open anywhere.</p></article>
      </div>
    </div></section>
    <section class="container guide-section guide-cta" id="guide">
      <div class="welcome-strip"><div><span class="eyebrow">For people who call it home</span><h2>Know a place like the back of your hand?</h2><p>Wherever you live in the world, your local knowledge can help someone feel welcome.</p></div><button class="btn" data-action="guide-interest">Join the guide interest list ${icon("arrow", 14)}</button></div>
    </section>
    <section class="portal-section" id="portals">
      <div class="container">
        <div class="section-heading"><div><span class="eyebrow">Designed for everyone</span><h2>Three simple portals. One community.</h2><p>Take a guided look at how travelers, local guides and the heymyGuide team could use the service.</p></div></div>
        <div class="portal-entry-grid">
          <article class="portal-entry"><span class="portal-entry-icon">${icon("search", 22)}</span><span class="eyebrow">FOR TRAVELERS</span><h3>Find your local guide</h3><p>Explore guide profiles, compare daily fees and trip costs, and see how a booking could work.</p><button class="btn btn-primary" data-action="portal-preview" data-portal="traveler">Preview traveler portal ${icon("arrow", 14)}</button></article>
          <article class="portal-entry"><span class="portal-entry-icon">${icon("pin", 22)}</span><span class="eyebrow">FOR LOCAL GUIDES</span><h3>Share your availability</h3><p>Show local knowledge, set your own guide fee and manage the days you can host.</p><button class="btn btn-primary" data-action="portal-preview" data-portal="guide">Preview guide portal ${icon("arrow", 14)}</button></article>
          <article class="portal-entry"><span class="portal-entry-icon">${icon("shield", 22)}</span><span class="eyebrow">FOR HEYMYGUIDE STAFF</span><h3>Care for the community</h3><p>Review reports, support travelers and guides, and oversee safety workflows.</p><button class="btn btn-primary" data-action="portal-preview" data-portal="admin">Preview admin portal ${icon("arrow", 14)}</button></article>
        </div>
        <p class="portal-disclaimer">Prototype walkthrough only · No accounts, real guide listings, bookings, SMS, chat translation or payments are connected. All example information is illustrative.</p>
      </div>
    </section>
  </main>${footer()}`;
}

function portalChatPreview() {
  return `<section class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">CHAT LANGUAGES</span><h3>Talk in the language you prefer</h3></div><span class="badge badge-review">Preview only</span></div>
    <div class="chat-preview"><div class="chat-preview-message">Hello! I can show you the old town and share a few local food spots.</div><div class="chat-preview-controls"><label for="chat-language">Show messages in</label><select id="chat-language"><option>English</option><option>العربية · Arabic</option><option>বাংলা · Bengali</option><option>हिन्दी · Hindi</option><option>ಕನ್ನಡ · Kannada</option><option>ಕٲشُر · Kashmiri</option><option>日本語 · Japanese</option><option>Español · Spanish</option><option>Français · French</option><option>Swahili</option></select><button class="btn btn-outline btn-small" data-action="translation-preview">Translate message</button></div><p class="portal-inline-note" id="translation-status" role="status">Translation requires a language provider and is not connected in this preview.</p></div>
  </section>`;
}

function openPortalPreview(portal) {
  const demoNotice = `<div class="demo-banner">${icon("shield", 17)} <span><strong>Design preview only.</strong> No account, booking, message or payment is created.</span></div>`;
  const views = {
    traveler: `<div class="portal-demo">
      ${demoNotice}
      <div class="portal-welcome"><div><span class="eyebrow">TRAVELER HOME · EXAMPLE</span><h3>Your next trip, your way.</h3><p>Choose any country, region and city—or enter a place manually—to explore local experiences.</p></div><span class="demo-avatar">B</span></div>
      ${travelerLocationPicker()}
      <div class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">SAMPLE AVAILABILITY · GUIDE LOCAL TIME</span><h3>Choose a day to request</h3></div></div><div class="demo-slots"><button type="button" class="demo-slot" data-action="demo-slot">Tue · 10:00–16:00 <span>Available · sample</span></button><button type="button" class="demo-slot" data-action="demo-slot">Wed · 09:00–15:00 <span>Available · sample</span></button></div><p class="portal-inline-note">A real request would need guide acceptance. This preview does not reserve a slot.</p></div>
      <div class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">PAYMENT · SAMPLE DISPLAY</span><h3>Pay your guide in person</h3></div></div><label class="cash-choice"><input type="radio" name="demo-payment" checked disabled><span><strong>Cash to guide after the trip</strong><small>Displayed as a concept only; no cash transaction or platform protection is provided.</small></span></label><p class="portal-inline-note">Online payment gateway: planned for later. Cash handling, cancellations, disputes, receipts, platform fees and country-specific rules must be defined before real bookings.</p></div>
      ${portalChatPreview()}
      <div class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">TRIP COMPLETION</span><h3>Confirm the trip ended</h3></div></div><p class="portal-copy">A future SMS one-time code should be entered by the traveler in the app—not shared with the guide. Phone verification and SMS delivery are not set up.</p><label class="form-group demo-otp-label">Completion code <input inputmode="numeric" placeholder="Unavailable until SMS is configured" disabled></label></div>
      <button class="btn btn-primary" data-action="demo-unavailable">Request this guide · demo only</button>
    </div>`,
    guide: `<div class="portal-demo">
      ${demoNotice}
      <div class="portal-welcome"><div><span class="eyebrow">GUIDE HOME · EXAMPLE</span><h3>Your local knowledge, on your schedule.</h3><p>Set the slots you can offer. Confirmed bookings would close overlapping times.</p></div><span class="demo-avatar">A</span></div>
      <div class="portal-summary-grid"><div><span>Profile</span><strong>Example · not verified</strong></div><div><span>Your daily fee</span><strong>Set in your currency</strong></div><div><span>Languages</span><strong>Add the languages you speak</strong></div><div><span>Booking status</span><strong>No live bookings</strong></div></div>
      <div class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">YOUR DAILY GUIDE FEE · EXAMPLE</span><h3>Set what you charge per day</h3></div><span class="badge badge-review">Sample guide profile</span></div><p class="portal-copy">Example local guide 1 · Srinagar, Jammu and Kashmir, India. Edit a sample daily fee and see it update in the traveler search preview.</p><form id="guide-rate-form" class="guide-rate-form"><label for="guide-rate-amount">Your guide fee per day</label><div class="guide-rate-fields"><input id="guide-rate-amount" name="amount" type="number" min="0.01" max="9999999.99" step="0.01" value="${escapeHTML(guideRatePreview.amount)}" required><select name="currency" aria-label="Fee currency">${currencyOptions.map(([code, name]) => `<option value="${code}" ${guideRatePreview.currency === code ? "selected" : ""}>${code} · ${name}</option>`).join("")}</select><button class="btn btn-primary" type="submit">Save sample fee</button></div><p class="portal-inline-note">This sample changes only in this browser session; it is not saved to an account or published as a real price.</p><p class="guide-rate-status" id="guide-rate-status" role="status" aria-live="polite"></p></form><div class="earnings-row"><span>Example completed local walk · 1 day</span><strong id="guide-rate-earned">${escapeHTML(formatDemoRate(guideRatePreview.amount, guideRatePreview.currency))}</strong></div><div class="earnings-row"><span>Guide receives · cash shown as concept</span><strong id="guide-rate-receives">${escapeHTML(formatDemoRate(guideRatePreview.amount, guideRatePreview.currency))}</strong></div><p class="portal-inline-note">Cash shown means the traveler pays the guide directly after the trip; the platform cannot confirm receipt. Any future platform fee, tax, invoice and payout rules must be disclosed before real bookings. Online payments are planned for later.</p></div>
      <div class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">AVAILABILITY · GUIDE LOCAL TIME</span><h3>Your upcoming slots</h3></div><span class="badge badge-pending">Example schedule</span></div><div class="demo-slots"><button type="button" class="demo-slot" data-action="demo-slot">Tue · 10:00–16:00 <span>Available · sample</span></button><button type="button" class="demo-slot" data-action="demo-slot">Wed · 09:00–15:00 <span>Available · sample</span></button><button type="button" class="demo-slot" data-action="demo-slot">Thu · unavailable <span>Not offered</span></button></div><p class="portal-inline-note">Selecting a sample slot only changes this preview. A live calendar must prevent double booking and handle cancellations and time-zone changes.</p></div>
      ${portalChatPreview()}
      <div class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">TRIP HANDOFF</span><h3>Traveler confirms completion</h3></div></div><p class="portal-copy">A future completion code is sent to the traveler's phone. The traveler enters it privately in heymyGuide. Don't ask the traveler to tell you the code.</p><span class="badge badge-review">SMS is not configured</span></div>
      <button class="btn btn-primary" data-action="demo-unavailable">Save availability · demo only</button>
    </div>`,
    admin: `<div class="portal-demo">
      ${demoNotice}
      <div class="portal-welcome"><div><span class="eyebrow">STAFF HOME · EXAMPLE</span><h3>Community care at a glance.</h3><p>Operational overview for authorized heymyGuide staff.</p></div><span class="demo-avatar">H</span></div>
      <div class="admin-demo-metrics"><div><strong>0</strong><span>Real travelers</span></div><div><strong>0</strong><span>Verified guides</span></div><div><strong>0</strong><span>Active bookings</span></div><div><strong>0</strong><span>Open reports</span></div></div>
      <div class="portal-module"><div class="portal-module-heading"><div><span class="eyebrow">ADMIN SAFETY</span><h3>Review before launch</h3></div><span class="badge badge-pending">Setup required</span></div><ul class="portal-checklist"><li>Staff-only sign-in and role-based permissions</li><li>Guide identity review with a specialist provider</li><li>Traveler support, complaints and incident response</li><li>Booking, cash-payment and cancellation policy</li><li>Audit trail, privacy controls and data retention</li></ul></div>
      <p class="portal-inline-note">This is a non-functional illustration. No admin sign-in, user data or moderation actions exist.</p>
    </div>`,
  };
  const titles = { traveler: "Traveler portal", guide: "Guide portal", admin: "Admin portal" };
  if (!views[portal]) return;
  openModal(titles[portal], "A simple walkthrough of the planned experience. This is not a live service.", views[portal], "portal-modal");
}

function openInterestForm(kind, destination = "") {
  if (!launchReady) {
    openModal("We're getting ready", "The interest form is temporarily unavailable while the privacy contact, company details and secure storage are configured. No information has been collected.", `<div class="readiness-card">${icon("shield", 18)}<div><strong>We won't collect your details until the form is ready.</strong><p>Please check back soon. The launch team can add verified contact details before opening the list.</p></div></div><a class="btn btn-outline" href="#places" data-action="close-modal">Explore the preview</a>`);
    return;
  }
  const isGuide = kind === "guide";
  const title = isGuide ? "Help shape heymyGuide." : "Let's plan for better trips.";
  const subtitle = isGuide ? "Join the guide interest list. This is not a job offer or a published profile." : "Join the traveler launch list. This doesn't book a trip or subscribe you to marketing.";
  const locationField = isGuide
    ? `<div class="form-group"><label for="lead-city">Your home city, region & country</label><input id="lead-city" name="city" maxlength="80" autocomplete="address-level2" placeholder="e.g. Srinagar, India · Nairobi, Kenya" required></div><div class="form-group"><label for="lead-languages">Languages you can guide in</label><input id="lead-languages" name="languages" maxlength="160" placeholder="e.g. Swahili, English" required></div>`
    : `<div class="form-group"><label for="lead-destination">Where would you like to explore?</label><input id="lead-destination" name="destination" maxlength="100" value="${escapeHTML(destination)}" placeholder="A city, region or country anywhere in the world" required></div><div class="form-group"><label for="lead-languages">Language you'd like to travel in <span class="muted">(optional)</span></label><input id="lead-languages" name="languages" maxlength="160" placeholder="e.g. Spanish, English, Arabic"></div>`;
  openModal(title, subtitle, `<form id="lead-form" data-kind="${kind}">
    <div class="form-group"><label for="lead-name">Name <span class="muted">(optional)</span></label><input id="lead-name" name="name" maxlength="100" autocomplete="name" placeholder="Your name"></div>
    <div class="form-group"><label for="lead-email">Email address</label><input id="lead-email" name="email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required></div>
    ${locationField}
    <div class="form-group trap-field" aria-hidden="true"><label for="lead-website">Leave this field empty</label><input id="lead-website" name="website" tabindex="-1" autocomplete="off"></div>
    <label class="consent-row"><input name="consent" type="checkbox" required><span>I agree that heymyGuide may use my details to contact me about ${isGuide ? "guide onboarding" : "the launch and my travel interest"}. This is not a marketing subscription. I can ask for deletion.</span></label>
    <p class="privacy-hint">Only the details above are requested. Don't submit ID documents, OTPs, payment details or sensitive personal information. Read our <a href="privacy.html" target="_blank" rel="noopener">privacy notice</a>.</p>
    <div class="form-status" role="status" aria-live="polite"></div>
    <button class="btn btn-primary" type="submit">${isGuide ? "Join the guide interest list" : "Join the traveler launch list"}</button>
  </form>`);
}

function openModal(title, subtitle, content, dialogClass = "") {
  const root = document.querySelector("#modal-root");
  root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal ${escapeHTML(dialogClass)}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button><h2 id="modal-title">${escapeHTML(title)}</h2><p class="modal-subtitle">${escapeHTML(subtitle)}</p>${content}</section></div>`;
  root.querySelector(".modal input:not([tabindex='-1']), .modal select")?.focus();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setFormStatus(form, message, kind) {
  const status = form.querySelector(".form-status");
  status.textContent = message;
  status.className = `form-status ${kind}`;
}

function render() {
  app.innerHTML = `${header()}${customerHome()}<div class="toast" id="toast" role="status" aria-live="polite"></div><div id="modal-root"></div>`;
  document.title = "heymyGuide — travel like you belong";
}

function bindEvents() {
  app.onclick = (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const { action } = target.dataset;
    if (action === "home") {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (action === "traveler-interest" || action === "guide-interest") {
      event.preventDefault();
      openInterestForm(action === "guide-interest" ? "guide" : "traveler", target.dataset.destination || "");
    } else if (action === "portal-preview") {
      event.preventDefault();
      openPortalPreview(target.dataset.portal);
    } else if (action === "translation-preview") {
      event.preventDefault();
      const selectedLanguage = document.querySelector("#chat-language")?.selectedOptions[0]?.textContent || "English";
      const status = document.querySelector("#translation-status");
      if (status) {
        const languageParts = selectedLanguage.split(" · ");
        status.textContent = `Translation into ${languageParts[languageParts.length - 1]} is not available until a translation provider is selected and connected.`;
      }
    } else if (action === "demo-slot") {
      event.preventDefault();
      const slot = target.querySelector("span");
      if (slot && !slot.textContent.includes("Not offered")) {
        slot.textContent = slot.textContent.includes("Available") ? "Unavailable · sample" : "Available · sample";
        showToast("Sample display changed only. No availability was saved.");
      }
    } else if (action === "demo-unavailable") {
      event.preventDefault();
      showToast("Demo only — no booking or changes were made.");
    } else if (action === "close-modal" || (action === "backdrop" && event.target === target)) {
      document.querySelector("#modal-root").innerHTML = "";
    }
  };

  app.onchange = (event) => {
    const locationLevel = event.target.dataset.locationLevel;
    if (locationLevel) updateLocationChoices(event.target.closest(".location-picker"), locationLevel);
  };

  app.oninput = (event) => {
    if (event.target.matches(".location-other")) updateLocationChoices(event.target.closest(".location-picker"), "manual");
  };

  app.onsubmit = async (event) => {
    if (event.target.id === "guide-rate-form") {
      event.preventDefault();
      const form = event.target;
      const amount = Number(form.elements.amount.value);
      const currency = form.elements.currency.value;
      const status = form.querySelector("#guide-rate-status");
      if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999.99 || !currencyOptions.some(([code]) => code === currency)) {
        status.textContent = "Enter a valid daily fee and choose a supported currency.";
        status.classList.add("error");
        return;
      }
      guideRatePreview.amount = amount.toFixed(2).replace(/\.00$/, "");
      guideRatePreview.currency = currency;
      const formattedRate = formatDemoRate(guideRatePreview.amount, currency);
      document.querySelector("#guide-rate-earned").textContent = formattedRate;
      document.querySelector("#guide-rate-receives").textContent = formattedRate;
      status.classList.remove("error");
      status.textContent = `${formattedRate} per day is saved in this preview session. Open the traveler portal and search Srinagar to see the sample fee.`;
      return;
    }
    if (event.target.id !== "lead-form") return;
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('button[type="submit"]');
    const fields = new FormData(form);
    submit.disabled = true;
    setFormStatus(form, "Sending your interest securely…", "info");
    const payload = {
      kind: form.dataset.kind,
      email: String(fields.get("email") || "").trim(),
      name: String(fields.get("name") || "").trim(),
      city: String(fields.get("city") || "").trim(),
      destination: String(fields.get("destination") || "").trim(),
      languages: String(fields.get("languages") || "").trim(),
      consent: fields.get("consent") === "on",
      website: String(fields.get("website") || "").trim(),
    };
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 201) {
        form.innerHTML = `<div class="success-panel">${icon("check", 22)}<h3>You're on the list.</h3><p>Thanks for helping shape heymyGuide. We'll contact you about ${payload.kind === "guide" ? "guide onboarding" : "the launch"} only. Your interest was recorded.</p></div>`;
        return;
      }
      const result = await response.json().catch(() => ({}));
      const message = response.status === 429
        ? "Too many attempts. Please wait a little and try again."
        : response.status === 400
          ? result.error || "Check the details and consent, then try again."
          : response.status === 503
            ? "The interest form is not ready yet. Your details were not saved."
            : "We couldn't confirm your submission. Your details were not confirmed as saved—please try again later.";
      setFormStatus(form, message, "error");
      submit.disabled = false;
    } catch {
      setFormStatus(form, "We couldn't reach the service. Your details were not confirmed as saved—please check your connection and try again.", "error");
      submit.disabled = false;
    }
  };
}

async function checkLaunchReadiness() {
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    launchReady = result.leadIntakeEnabled === true;
    if (launchReady && typeof result.supportEmail === "string") {
      const contact = document.querySelector("#support-contact");
      const link = document.createElement("a");
      link.href = `mailto:${result.supportEmail}`;
      link.textContent = result.supportEmail;
      contact.replaceWith(link);
    }
  } catch {
    launchReady = false;
  }
}

render();
bindEvents();
checkLaunchReadiness();
