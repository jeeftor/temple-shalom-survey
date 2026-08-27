/**
 * Temple Shalom Survey — Cloudflare Worker
 *
 * POST /submit   — receive survey response, write to D1
 * GET  /export   — download all responses as CSV
 * GET  /health   — quick sanity check
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS preflight
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
      return json({ status: "ok", ts: new Date().toISOString() });
    }

    return new Response("Not found", { status: 404 });
  }
};

// ── Submit ───────────────────────────────────────────────────────────────────

async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const timestamp  = body.timestamp  || new Date().toISOString();
  const session    = body._session    || null;
  const userAgent  = body._userAgent  || null;
  const payload    = JSON.stringify(body);

  try {
    await env.DB.prepare(
      `INSERT INTO responses (timestamp, session_id, user_agent, payload)
       VALUES (?, ?, ?, ?)`
    ).bind(timestamp, session, userAgent, payload).run();

    return json({ success: true }, 200);
  } catch (err) {
    console.error("DB insert failed:", err.message);
    return json({ success: false, error: err.message }, 500);
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

async function handleExport(request, env) {
  // Simple auth: ?key=EXPORT_KEY
  const url = new URL(request.url);
  if (env.EXPORT_KEY && url.searchParams.get("key") !== env.EXPORT_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rows = await env.DB.prepare(
    "SELECT id, timestamp, session_id, user_agent, payload FROM responses ORDER BY id"
  ).all();

  if (!rows.results.length) {
    return new Response("No responses yet.", {
      headers: { "Content-Type": "text/plain" }
    });
  }

  // Collect all question keys across all rows
  const keySet = new Set();
  const parsed = rows.results.map(row => {
    const data = JSON.parse(row.payload || "{}");
    Object.keys(data).forEach(k => keySet.add(k));
    return { meta: row, data };
  });

  const qKeys    = [...keySet].filter(k => !k.startsWith("_") && k !== "timestamp").sort();
  const headers  = ["id", "timestamp", "session_id", ...qKeys];
  const csvRows  = [headers.map(csvEscape).join(",")];

  for (const { meta, data } of parsed) {
    const row = [
      meta.id,
      meta.timestamp,
      meta.session_id || "",
      ...qKeys.map(k => {
        const v = data[k];
        if (v === undefined || v === null) return "";
        if (typeof v === "object") return csvEscape(JSON.stringify(v));
        return csvEscape(String(v));
      })
    ];
    csvRows.push(row.join(","));
  }

  return new Response(csvRows.join("\r\n"), {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="survey-responses-${new Date().toISOString().slice(0,10)}.csv"`,
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function csvEscape(val) {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
