/**
 * Temple Shalom Survey — Cloudflare Worker
 *
 * POST /submit         — receive survey response, write to D1
 * GET  /export?key=X  — download all responses as CSV (protected)
 * GET  /results?key=X — all responses as JSON (protected)
 * GET  /health        — sanity check + response count
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Simple in-memory rate limit: max 5 submits per IP per minute
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now  = Date.now();
  const key  = ip;
  const hits = (rateLimitMap.get(key) || []).filter(t => now - t < 60_000);
  hits.push(now);
  rateLimitMap.set(key, hits);
  return hits.length > 5;
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/submit" && method === "POST") {
      return handleSubmit(request, env);
    }
    if (url.pathname === "/export" && method === "GET") {
      return handleExport(request, env);
    }
    if (url.pathname === "/health") {
      return handleHealth(env);
    }
    if (url.pathname === "/results" && method === "GET") {
      return handleResults(request, env);
    }

    return new Response("Not found", { status: 404 });
  }
};

// ── Submit ────────────────────────────────────────────────────────────────────

async function handleSubmit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (isRateLimited(ip)) {
    return json({ success: false, error: "Too many requests" }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  // ── Server-stamped metadata (client cannot fake these) ──────────────────
  const responseId         = crypto.randomUUID();
  const timestamp          = new Date().toISOString();
  const ipCountry          = request.cf?.country      || null;
  const cfRay              = request.headers.get("CF-Ray") || null;

  // ── Client-provided metadata (trusted but not guaranteed) ───────────────
  const sessionId          = body._session            || null;
  const surveyVersion      = body._survey_version     || null;
  const completionSeconds  = body._completion_seconds || null;
  const sectionsAnswered   = body._sections_answered
    ? JSON.stringify(body._sections_answered) : null;
  const userAgent          = body._userAgent          || null;
  const referrer           = body._referrer           || null;

  const payload = JSON.stringify(body);

  // ── Re-submission linking: find prior submissions from this session ──────
  let submissionNumber   = 1;
  let previousResponseId = null;
  if (sessionId) {
    const prior = await env.DB.prepare(
      `SELECT response_id FROM responses
       WHERE session_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(sessionId).first();
    if (prior) {
      previousResponseId = prior.response_id;
      const count = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM responses WHERE session_id = ?`
      ).bind(sessionId).first();
      submissionNumber = (count?.n || 0) + 1;
    }
  }

  try {
    await env.DB.prepare(`
      INSERT INTO responses
        (response_id, timestamp, session_id, submission_number, previous_response_id,
         survey_version, ip_country, cf_ray, completion_seconds, sections_answered,
         user_agent, referrer, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      responseId, timestamp, sessionId, submissionNumber, previousResponseId,
      surveyVersion, ipCountry, cfRay, completionSeconds, sectionsAnswered,
      userAgent, referrer, payload
    ).run();

    // ── Dual-write to Google Sheets (best-effort, non-blocking) ────────────
    // D1 is the source of truth. If Sheets fails, we log but still succeed.
    if (env.GS_WEBHOOK_URL && env.GS_WEBHOOK_TOKEN) {
      const sheetPayload = {
        ...body,
        webhook_token:        env.GS_WEBHOOK_TOKEN,
        response_id:          responseId,
        timestamp:            timestamp,
        session_id:           sessionId,
        submission_number:    submissionNumber,
        previous_response_id: previousResponseId,
        survey_version:       surveyVersion,
        ip_country:           ipCountry,
        cf_ray:               cfRay,
        completion_seconds:   completionSeconds,
        sections_answered:    body._sections_answered || null,
        user_agent:           userAgent,
        referrer:             referrer,
      };
      // Remove underscore-prefixed client metadata (already mapped above)
      for (const k of Object.keys(sheetPayload)) {
        if (k.startsWith("_")) delete sheetPayload[k];
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        // Apps Script returns a 302 redirect after POST; fetch() follows it
        // but converts POST→GET, landing on a "Page Not Found" HTML page.
        // Use redirect:"manual" and follow the Location header ourselves.
        const gsResponse = await fetch(env.GS_WEBHOOK_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(sheetPayload),
          redirect: "manual",
          signal:  controller.signal,
        });
        clearTimeout(timeout);

        let finalResponse = gsResponse;
        if (gsResponse.status === 302) {
          const redirectUrl = gsResponse.headers.get("location");
          if (redirectUrl) {
            finalResponse = await fetch(redirectUrl, {
              signal: controller.signal,
            });
          }
        }

        const gsResult = await finalResponse.json();
        if (!finalResponse.ok || !gsResult.success) {
          throw new Error(gsResult.error || `HTTP ${finalResponse.status}`);
        }
      } catch (gsErr) {
        // Sheets write failed — log but don't fail the submission
        console.error("Google Sheets write failed:", gsErr.message);
      }
    }

    return json({ success: true, response_id: responseId });
  } catch (err) {
    // Duplicate session within same day = likely dupe submission
    if (err.message?.includes("UNIQUE")) {
      return json({ success: false, error: "duplicate" }, 409);
    }
    console.error("DB insert failed:", err.message);
    return json({ success: false, error: "server_error" }, 500);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

async function handleExport(request, env) {
  const url = new URL(request.url);
  if (!env.EXPORT_KEY || url.searchParams.get("key") !== env.EXPORT_KEY) {
    return new Response("Unauthorized — supply ?key=YOUR_EXPORT_KEY", { status: 401 });
  }

  const rows = await env.DB.prepare(`
    SELECT id, response_id, timestamp, session_id, submission_number, previous_response_id,
           survey_version, ip_country, completion_seconds, sections_answered, referrer, payload
    FROM responses ORDER BY id
  `).all();

  if (!rows.results.length) {
    return new Response("No responses yet.", { headers: { "Content-Type": "text/plain" } });
  }

  // Collect all question keys
  const keySet = new Set();
  const parsed = rows.results.map(row => {
    const data = JSON.parse(row.payload || "{}");
    Object.keys(data)
      .filter(k => !k.startsWith("_") && k !== "timestamp")
      .forEach(k => keySet.add(k));
    return { meta: row, data };
  });

  const qKeys   = [...keySet].sort();
  const headers = [
    "id", "response_id", "timestamp", "session_id",
    "submission_number", "previous_response_id",
    "survey_version", "ip_country", "completion_seconds", "sections_answered",
    "referrer",
    ...qKeys
  ];

  const csvRows = [headers.map(csvEsc).join(",")];
  for (const { meta, data } of parsed) {
    const row = [
      meta.id,
      meta.response_id   || "",
      meta.timestamp     || "",
      meta.session_id    || "",
      meta.submission_number || "",
      meta.previous_response_id || "",
      meta.survey_version    || "",
      meta.ip_country        || "",
      meta.completion_seconds ?? "",
      meta.sections_answered || "",
      meta.referrer          || "",
      ...qKeys.map(k => {
        const v = data[k];
        if (v == null) return "";
        return csvEsc(typeof v === "object" ? JSON.stringify(v) : String(v));
      })
    ];
    csvRows.push(row.join(","));
  }

  return new Response(csvRows.join("\r\n"), {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="survey-${new Date().toISOString().slice(0,10)}.csv"`,
    }
  });
}

// ── Results (JSON) ────────────────────────────────────────────────────────────

async function handleResults(request, env) {
  const url = new URL(request.url);
  if (!env.EXPORT_KEY || url.searchParams.get("key") !== env.EXPORT_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  const rows = await env.DB.prepare(`
    SELECT id, response_id, timestamp, session_id, submission_number, previous_response_id,
           survey_version, ip_country, completion_seconds, sections_answered, referrer, payload
    FROM responses ORDER BY id DESC
  `).all();

  const responses = (rows.results || []).map(row => ({
    id:                 row.id,
    response_id:        row.response_id,
    timestamp:          row.timestamp,
    session_id:         row.session_id,
    submission_number:  row.submission_number,
    previous_response_id: row.previous_response_id,
    survey_version:     row.survey_version,
    ip_country:         row.ip_country,
    completion_seconds: row.completion_seconds,
    sections_answered:  row.sections_answered ? JSON.parse(row.sections_answered) : null,
    referrer:           row.referrer,
    answers:            (() => {
      const d = JSON.parse(row.payload || "{}");
      return Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("_") && k !== "timestamp"));
    })(),
  }));

  return json({ count: responses.length, responses });
}

// ── Health ────────────────────────────────────────────────────────────────────

async function handleHealth(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) as n FROM responses").first();
  return json({
    status: "ok",
    responses: row?.n ?? 0,
    sheets_configured: Boolean(env.GS_WEBHOOK_URL && env.GS_WEBHOOK_TOKEN),
    ts: new Date().toISOString(),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function csvEsc(val) {
  val = String(val);
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
