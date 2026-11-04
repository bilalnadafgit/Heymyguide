import {
  channelReady,
  consumeRateLimit,
  getSession,
  hmac,
  json,
  marketplaceReady,
  methodNotAllowed,
  randomDigits,
  readJson,
  requireRole,
  sameOriginJson,
  secureEqual,
  sendOtp,
  validObject,
  uuid,
} from "../../lib/marketplace.js";

async function expireUnacceptedBookings(db) {
  await db.prepare(`
    UPDATE guide_bookings
    SET status = 'cancelled', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE status = 'requested'
      AND availability_id IN (
        SELECT id FROM guide_availability
        WHERE status = 'booked' AND hold_expires_at IS NOT NULL AND hold_expires_at <= unixepoch()
      )
  `).run();
}

function mapBooking(row) {
  return {
    id: row.id,
    role: row.role,
    guideId: row.guide_user_id,
    guideName: row.guide_name,
    guideCity: row.city,
    travelerId: row.traveler_user_id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dailyFeeMinor: row.guide_fee_minor,
    currency: row.currency,
    paymentMethod: row.payment_method,
    cashStatus: row.cash_status,
    experience: row.experience_title ? {
      id: row.experience_id,
      title: row.experience_title,
      durationMinutes: row.experience_duration,
    } : null,
    requestedAt: row.requested_at,
    confirmedAt: row.confirmed_at,
    completedAt: row.completed_at,
  };
}

async function readBooking(db, bookingId, session) {
  return db.prepare(`
    SELECT booking.*, profile.display_name AS guide_name, profile.city,
           experience.title AS experience_title,
           experience.duration_minutes AS experience_duration,
           ? AS role
    FROM guide_bookings booking
    JOIN guide_profiles profile ON profile.user_id = booking.guide_user_id
    LEFT JOIN guide_experiences experience ON experience.id = booking.experience_id
    WHERE booking.id = ?
      AND (booking.traveler_user_id = ? OR booking.guide_user_id = ?)
    LIMIT 1
  `).bind(session.role, bookingId, session.id, session.id).first();
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!marketplaceReady(env)) return json({ error: "Bookings are not available." }, 503);
  const session = await getSession(context);
  if (!requireRole(session, ["traveler", "guide"])) return json({ error: "Sign in to view bookings." }, 401);
  try {
    await expireUnacceptedBookings(env.DB);
    const ownerColumn = session.role === "guide" ? "guide_user_id" : "traveler_user_id";
    const result = await env.DB.prepare(`
      SELECT booking.*, profile.display_name AS guide_name, profile.city,
             experience.title AS experience_title,
             experience.duration_minutes AS experience_duration,
             ? AS role
      FROM guide_bookings booking
      JOIN guide_profiles profile ON profile.user_id = booking.guide_user_id
      LEFT JOIN guide_experiences experience ON experience.id = booking.experience_id
      WHERE booking.${ownerColumn} = ?
      ORDER BY booking.starts_at DESC LIMIT 100
    `).bind(session.role, session.id).all();
    return json({ bookings: (result.results || []).map(mapBooking) });
  } catch (error) {
    console.error(`Booking read failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "Bookings are temporarily unavailable." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Bookings are not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!requireRole(session, ["traveler"])) return json({ error: "Sign in as a traveler to request a guide." }, 401);
  if (!session.phone_verified_at) return json({ error: "Verify a phone number before requesting a guide; it is needed for trip-completion confirmation." }, 403);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validObject(payload, ["availabilityId", "experienceId"])
    || typeof payload.availabilityId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(payload.availabilityId)
    || (payload.experienceId !== undefined && payload.experienceId !== null
      && (typeof payload.experienceId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.experienceId)))) {
    return json({ error: "Choose a valid available slot and experience." }, 400);
  }
  try {
    await expireUnacceptedBookings(env.DB);
    const slot = await env.DB.prepare(`
      SELECT slot.id, slot.guide_user_id, slot.starts_at, slot.ends_at,
             profile.daily_fee_minor, profile.currency
      FROM guide_availability slot
      JOIN guide_profiles profile ON profile.user_id = slot.guide_user_id
      JOIN marketplace_users guide ON guide.id = profile.user_id
      WHERE slot.id = ? AND slot.status = 'open'
        AND slot.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND profile.public_listing = 1
        AND profile.verification_status = 'approved'
        AND guide.status = 'active'
        AND guide.phone_verified_at IS NOT NULL
      LIMIT 1
    `).bind(payload.availabilityId).first();
    if (!slot) return json({ error: "That guide slot is no longer available." }, 409);

    if (payload.experienceId) {
      const experience = await env.DB.prepare(`
        SELECT id FROM guide_experiences WHERE id = ? AND guide_user_id = ? AND active = 1
      `).bind(payload.experienceId, slot.guide_user_id).first();
      if (!experience) return json({ error: "Choose an experience offered by this guide." }, 400);
    }

    const bookingId = uuid();
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE guide_availability
        SET status = 'held', hold_expires_at = unixepoch() + 900
        WHERE id = ? AND status = 'open'
          AND starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          AND guide_user_id = ?
      `).bind(slot.id, slot.guide_user_id),
      env.DB.prepare(`
        INSERT INTO guide_bookings (
          id, traveler_user_id, guide_user_id, availability_id, experience_id,
          status, starts_at, ends_at, guide_fee_minor, currency, payment_method, cash_status
        )
        SELECT ?, ?, slot.guide_user_id, slot.id, ?,
               'requested', slot.starts_at, slot.ends_at,
               profile.daily_fee_minor, profile.currency, 'cash_direct', 'not_due'
        FROM guide_availability slot
        JOIN guide_profiles profile ON profile.user_id = slot.guide_user_id
        JOIN marketplace_users guide ON guide.id = profile.user_id
        JOIN marketplace_users traveler ON traveler.id = ?
        WHERE slot.id = ? AND slot.status = 'held'
          AND slot.hold_expires_at > unixepoch()
          AND profile.public_listing = 1
          AND profile.verification_status = 'approved'
          AND guide.role = 'guide' AND guide.status = 'active'
          AND guide.phone_verified_at IS NOT NULL
          AND traveler.role = 'traveler' AND traveler.status = 'active'
          AND traveler.phone_verified_at IS NOT NULL
          AND (? IS NULL OR EXISTS (
            SELECT 1 FROM guide_experiences experience
            WHERE experience.id = ? AND experience.guide_user_id = slot.guide_user_id
              AND experience.active = 1
          ))
      `).bind(bookingId, session.id, payload.experienceId || null, session.id, slot.id, payload.experienceId || null, payload.experienceId || null),
    ]);
    if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
      await env.DB.prepare(`
        UPDATE guide_availability SET status = 'open', hold_expires_at = NULL
        WHERE id = ? AND status = 'held' AND NOT EXISTS (
          SELECT 1 FROM guide_bookings WHERE availability_id = ?
        )
      `).bind(slot.id, slot.id).run();
      return json({ error: "That slot was just taken or could not be booked." }, 409);
    }
    await env.DB.prepare(`
      INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, booking_id, event_type, details_json)
      VALUES (?, ?, ?, 'booking.requested', ?)
    `).bind(session.id, slot.guide_user_id, bookingId, JSON.stringify({ availabilityId: slot.id })).run();
    const booking = await readBooking(env.DB, bookingId, session);
    return json({ booking: mapBooking(booking), message: "Your request was sent to the guide. The slot is held for 15 minutes while they respond." }, 201);
  } catch (error) {
    if (error instanceof Error && /overlap|UNIQUE constraint|invalid booking/i.test(error.message)) {
      return json({ error: "That slot is no longer available." }, 409);
    }
    console.error(`Booking create failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "The booking request could not be completed." }, 503);
  }
}

async function requestCompletionCode(env, booking, session) {
  if (!booking || booking.guide_user_id !== session.id || booking.status !== "in_progress") {
    return json({ error: "Only the guide on an active trip can request trip completion." }, 409);
  }
  if (Date.parse(booking.ends_at) > Date.now()) return json({ error: "The completion code can be requested after the scheduled trip end." }, 409);
  if (!channelReady(env, "phone")) return json({ error: "Phone OTP is not configured; no completion code was sent." }, 503);
  const traveler = await env.DB.prepare(`
    SELECT phone_e164 FROM marketplace_users
    WHERE id = ? AND role = 'traveler' AND status = 'active' AND phone_verified_at IS NOT NULL
  `).bind(booking.traveler_user_id).first();
  if (!traveler?.phone_e164) return json({ error: "The traveler has no verified phone for trip completion." }, 409);
  const ip = booking.request_ip || "completion";
  if (!(await consumeRateLimit(env.DB, env.AUTH_HMAC_SECRET, `completion:${booking.id}:${ip}`, 3, 900))) {
    return json({ error: "Too many completion-code requests. Wait before trying again." }, 429, { "Retry-After": "900" });
  }
  const code = randomDigits(6);
  const codeHash = await hmac(env.AUTH_HMAC_SECRET, `${booking.id}:${code}`);
  await env.DB.prepare(`
    INSERT INTO booking_completion_challenges (booking_id, code_hash, expires_at, attempts, verified_at)
    VALUES (?, ?, unixepoch() + 900, 0, NULL)
    ON CONFLICT(booking_id) DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      verified_at = NULL,
      created_at = unixepoch()
  `).bind(booking.id, codeHash).run();
  try {
    await sendOtp(env, "phone", traveler.phone_e164, code);
    const result = await env.DB.prepare(`
      UPDATE guide_bookings SET status = 'completion_pending'
      WHERE id = ? AND guide_user_id = ? AND status = 'in_progress'
        AND julianday(ends_at) <= julianday('now')
      RETURNING id
    `).bind(booking.id, session.id).first();
    if (!result) {
      await env.DB.prepare("DELETE FROM booking_completion_challenges WHERE booking_id = ? AND verified_at IS NULL").bind(booking.id).run();
      return json({ error: "The trip state changed before the completion code could be sent." }, 409);
    }
    return json({ completionCodeSent: true, expiresInSeconds: 900, message: "A code was sent to the traveler's verified phone. The traveler must enter it privately in heymyGuide; never ask them to share it." });
  } catch (error) {
    await env.DB.prepare("DELETE FROM booking_completion_challenges WHERE booking_id = ? AND verified_at IS NULL").bind(booking.id).run();
    console.error(`Completion code send failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "The completion code could not be sent; the trip is not marked complete." }, 503);
  }
}

async function verifyCompletionCode(env, booking, session, code) {
  if (!booking || booking.traveler_user_id !== session.id || booking.status !== "completion_pending") {
    return json({ error: "There is no trip completion awaiting your confirmation." }, 409);
  }
  if (!session.phone_verified_at) return json({ error: "Verify your phone before confirming trip completion." }, 403);
  const challenge = await env.DB.prepare(`
    SELECT code_hash, expires_at, attempts, verified_at FROM booking_completion_challenges
    WHERE booking_id = ? LIMIT 1
  `).bind(booking.id).first();
  if (!challenge || challenge.verified_at !== null || challenge.expires_at <= Math.floor(Date.now() / 1000) || challenge.attempts >= 5) {
    return json({ error: "The completion code is invalid or expired." }, 400);
  }
  const attempt = await env.DB.prepare(`
    UPDATE booking_completion_challenges SET attempts = attempts + 1
    WHERE booking_id = ? AND verified_at IS NULL AND expires_at > unixepoch() AND attempts < 5
    RETURNING attempts
  `).bind(booking.id).first();
  if (!attempt) return json({ error: "The completion code is invalid or expired." }, 400);
  const supplied = await hmac(env.AUTH_HMAC_SECRET, `${booking.id}:${code}`);
  if (!secureEqual(supplied, challenge.code_hash)) return json({ error: "The completion code is invalid or expired." }, 400);

  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE booking_completion_challenges SET verified_at = unixepoch()
      WHERE booking_id = ? AND verified_at IS NULL AND expires_at > unixepoch()
        AND code_hash = ? AND attempts <= 5
      RETURNING booking_id
    `).bind(booking.id, challenge.code_hash),
    env.DB.prepare(`
      UPDATE guide_bookings SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND traveler_user_id = ? AND status = 'completion_pending'
        AND EXISTS (
          SELECT 1 FROM booking_completion_challenges
          WHERE booking_id = ? AND verified_at IS NOT NULL
        )
      RETURNING id
    `).bind(booking.id, session.id, booking.id),
  ]);
  if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
    return json({ error: "Trip completion could not be confirmed. Contact support." }, 409);
  }
  await env.DB.prepare(`
    INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, booking_id, event_type)
    VALUES (?, ?, ?, 'booking.completed_by_traveler')
  `).bind(session.id, booking.guide_user_id, booking.id).run();
  return json({ completed: true, cashStatus: "due", message: "Trip completion confirmed. Pay the guide directly in cash as agreed." });
}

export async function onRequestPatch({ request, env }) {
  if (!marketplaceReady(env)) return json({ error: "Bookings are not available." }, 503);
  if (!sameOriginJson(request)) return json({ error: "Request not allowed." }, 403);
  const session = await getSession({ request, env });
  if (!requireRole(session, ["traveler", "guide"])) return json({ error: "Sign in to manage bookings." }, 401);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request is too large." : "Invalid request." }, error instanceof RangeError ? 413 : 400);
  }
  if (!validObject(payload, ["bookingId", "action", "code"])
    || typeof payload.bookingId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(payload.bookingId)
    || typeof payload.action !== "string") {
    return json({ error: "Check the booking action." }, 400);
  }
  if (payload.action === "confirm_completion") {
    if (typeof payload.code !== "string" || !/^\d{6}$/.test(payload.code)) return json({ error: "Enter the six-digit completion code." }, 400);
    try {
      const booking = await readBooking(env.DB, payload.bookingId, session);
      return await verifyCompletionCode(env, booking, session, payload.code);
    } catch (error) {
      console.error(`Completion verification failed: ${error instanceof Error ? error.name : "unknown error"}`);
      return json({ error: "Trip completion could not be verified." }, 503);
    }
  }

  try {
    await expireUnacceptedBookings(env.DB);
    const booking = await readBooking(env.DB, payload.bookingId, session);
    if (!booking) return json({ error: "Booking not found." }, 404);
    if (payload.action === "request_completion_code") return await requestCompletionCode(env, booking, session);

    if (payload.action === "accept" || payload.action === "decline") {
      if (session.role !== "guide" || booking.guide_user_id !== session.id || booking.status !== "requested") {
        return json({ error: "Only the assigned guide can respond to a pending request." }, 403);
      }
      const status = payload.action === "accept" ? "confirmed" : "cancelled";
      const results = await env.DB.batch([
        env.DB.prepare(`
          UPDATE guide_bookings
          SET status = ?, confirmed_at = CASE WHEN ? = 'confirmed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END,
              cancelled_at = CASE WHEN ? = 'cancelled' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END
          WHERE id = ? AND guide_user_id = ? AND status = 'requested'
            AND EXISTS (
              SELECT 1 FROM guide_availability
              WHERE id = guide_bookings.availability_id AND status = 'booked'
                AND hold_expires_at > unixepoch()
            )
          RETURNING id
        `).bind(status, status, status, booking.id, session.id),
        env.DB.prepare(`
          UPDATE guide_availability SET hold_expires_at = NULL
          WHERE id = ? AND status = 'booked'
            AND EXISTS (SELECT 1 FROM guide_bookings WHERE id = ? AND status = 'confirmed')
        `).bind(booking.availability_id, booking.id),
      ]);
      if (results[0]?.meta?.changes !== 1) return json({ error: "This request expired or has already changed." }, 409);
      await env.DB.prepare(`
        INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, booking_id, event_type)
        VALUES (?, ?, ?, ?)
      `).bind(session.id, booking.traveler_user_id, booking.id, status === "confirmed" ? "booking.accepted" : "booking.declined").run();
      return json({ booking: mapBooking(await readBooking(env.DB, booking.id, session)) });
    }

    if (payload.action === "start") {
      if (session.role !== "guide" || booking.guide_user_id !== session.id || booking.status !== "confirmed") {
        return json({ error: "Only the assigned guide can start a confirmed trip." }, 403);
      }
      const result = await env.DB.prepare(`
        UPDATE guide_bookings SET status = 'in_progress'
        WHERE id = ? AND guide_user_id = ? AND status = 'confirmed'
          AND julianday(starts_at) <= julianday('now')
          AND julianday(ends_at) > julianday('now')
        RETURNING id
      `).bind(booking.id, session.id).first();
      if (!result) return json({ error: "The trip can start only during its confirmed time slot." }, 409);
      return json({ booking: mapBooking(await readBooking(env.DB, booking.id, session)) });
    }

    if (payload.action === "cancel") {
      if (!["traveler", "guide"].includes(session.role)
        || (session.role === "traveler" && booking.traveler_user_id !== session.id)
        || (session.role === "guide" && booking.guide_user_id !== session.id)
        || !["requested", "confirmed"].includes(booking.status)) {
        return json({ error: "This booking cannot be cancelled by this account." }, 403);
      }
      const result = await env.DB.prepare(`
        UPDATE guide_bookings
        SET status = 'cancelled', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status IN ('requested', 'confirmed')
        RETURNING id
      `).bind(booking.id).first();
      if (!result) return json({ error: "This booking has already changed." }, 409);
      return json({ booking: mapBooking(await readBooking(env.DB, booking.id, session)) });
    }

    if (payload.action === "report_cash_paid") {
      if (session.role !== "guide" || booking.guide_user_id !== session.id || booking.status !== "completed" || booking.cash_status !== "due") {
        return json({ error: "Only the assigned guide can report cash due after a completed trip." }, 403);
      }
      const result = await env.DB.prepare(`
        UPDATE guide_bookings SET cash_status = 'guide_reported_paid'
        WHERE id = ? AND guide_user_id = ? AND status = 'completed' AND cash_status = 'due'
        RETURNING id
      `).bind(booking.id, session.id).first();
      if (!result) return json({ error: "Cash status has already changed." }, 409);
      await env.DB.prepare(`
        INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, booking_id, event_type)
        VALUES (?, ?, ?, 'cash.reported_by_guide')
      `).bind(session.id, booking.traveler_user_id, booking.id).run();
      return json({ booking: mapBooking(await readBooking(env.DB, booking.id, session)), message: "Cash marked as reported by guide; awaiting traveler confirmation. This is not proof of payment." });
    }

    if (payload.action === "confirm_cash" || payload.action === "dispute_cash") {
      if (session.role !== "traveler" || booking.traveler_user_id !== session.id || booking.status !== "completed"
        || !["due", "guide_reported_paid"].includes(booking.cash_status)) {
        return json({ error: "Only the traveler can confirm or dispute cash for this completed trip." }, 403);
      }
      const cashStatus = payload.action === "confirm_cash" ? "traveler_confirmed" : "disputed";
      const update = payload.action === "dispute_cash"
        ? env.DB.prepare(`
          UPDATE guide_bookings SET cash_status = 'disputed', status = 'disputed'
          WHERE id = ? AND traveler_user_id = ? AND status = 'completed'
            AND cash_status IN ('due', 'guide_reported_paid')
          RETURNING id
        `).bind(booking.id, session.id)
        : env.DB.prepare(`
          UPDATE guide_bookings SET cash_status = ?
          WHERE id = ? AND traveler_user_id = ? AND status = 'completed'
            AND cash_status = 'guide_reported_paid'
          RETURNING id
        `).bind(cashStatus, booking.id, session.id);
      const result = await update.first();
      if (!result) return json({ error: "Cash status changed or the guide has not reported receiving cash." }, 409);
      await env.DB.prepare(`
        INSERT INTO marketplace_audit_events (actor_user_id, subject_user_id, booking_id, event_type)
        VALUES (?, ?, ?, ?)
      `).bind(session.id, booking.guide_user_id, booking.id, cashStatus === "disputed" ? "cash.disputed_by_traveler" : "cash.confirmed_by_traveler").run();
      return json({ booking: mapBooking(await readBooking(env.DB, booking.id, session)), message: cashStatus === "disputed" ? "A dispute was recorded. Contact support; no funds are held by the platform." : "Cash receipt confirmed by the traveler." });
    }
    return json({ error: "Unknown booking action." }, 400);
  } catch (error) {
    console.error(`Booking update failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return json({ error: "The booking could not be updated." }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return methodNotAllowed("GET, POST, PATCH");
}
