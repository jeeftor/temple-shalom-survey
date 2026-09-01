/**
 * Temple Shalom Member Survey 2026
 * Google Apps Script — Survey Submit Endpoint (dual-write from CF Worker)
 *
 * The Cloudflare Worker writes to D1, then POSTs the same payload here.
 * This script appends a row to the Google Sheet with all metadata columns
 * plus every question answer.
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com and create a new project.
 * 2. Paste this entire file into the editor.
 * 3. Set SHEET_ID below to the ID of your Google Sheet
 *    (the long string in the Sheet's URL between /d/ and /edit).
 * 4. In Project Settings > Script Properties, add WEBHOOK_TOKEN with a
 *    randomly generated secret value.
 * 5. Click Deploy > New Deployment > Web App.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Copy the deployment URL and set it as a Cloudflare Worker secret:
 *    npx wrangler secret put GS_WEBHOOK_URL
 * 7. Set the same token as a second Cloudflare Worker secret:
 *    npx wrangler secret put GS_WEBHOOK_TOKEN
 */

const SHEET_ID   = "1U4yxBRCslfJtbCOx--HwfagQd0pu8Ys4G8H1FCmrBk4";
const SHEET_NAME = "Responses";  // tab name inside the spreadsheet

// Metadata columns that always come first (in this order).
// These are sent by the Cloudflare Worker, not the browser.
const META_COLUMNS = [
  "response_id",
  "timestamp",
  "session_id",
  "survey_version",
  "ip_country",
  "cf_ray",
  "completion_seconds",
  "sections_answered",
  "user_agent",
];

/**
 * Handle incoming survey POST requests.
 * The CF Worker sends the full payload including server-stamped metadata.
 */
function doPost(e) {
  try {
    const raw  = e.postData.contents;
    const data = JSON.parse(raw);
    const expectedToken = PropertiesService.getScriptProperties().getProperty("WEBHOOK_TOKEN");
    if (!expectedToken || data.webhook_token !== expectedToken) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }
    delete data.webhook_token;

    const ss    = SpreadsheetApp.openById(SHEET_ID);
    let   sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    // Reserved keys: metadata first, then sorted question keys
    const reservedKeys = [...META_COLUMNS, "timestamp"];
    const dataKeys     = Object.keys(data)
      .filter(k => !reservedKeys.includes(k) && !k.startsWith("_"))
      .sort();
    const allKeys      = [...META_COLUMNS, ...dataKeys];

    // Write or update header row
    ensureHeaders(sheet, allKeys);

    // Append response row
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row     = headers.map(h => {
      const val = data[h];
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return val;
    });

    sheet.appendRow(row);

    return jsonResponse({ success: true });

  } catch (err) {
    console.error("Survey submit error:", err);
    return jsonResponse({ success: false, error: err.message });
  }
}

/**
 * Ensure the sheet has a header row that covers all expected keys.
 * Adds any new keys to the right without disturbing existing columns.
 */
function ensureHeaders(sheet, keys) {
  if (sheet.getLastRow() === 0) {
    // Fresh sheet — write headers
    sheet.appendRow(keys);
    sheet.getRange(1, 1, 1, keys.length)
      .setFontWeight("bold")
      .setBackground("#5b2d8e")
      .setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    return;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const existingSet     = new Set(existingHeaders);
  const newKeys         = keys.filter(k => !existingSet.has(k));

  if (newKeys.length > 0) {
    const startCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, startCol, 1, newKeys.length).setValues([newKeys]);
    sheet.getRange(1, startCol, 1, newKeys.length)
      .setFontWeight("bold")
      .setBackground("#5b2d8e")
      .setFontColor("#ffffff");
  }
}

/**
 * Allow browser preflight CORS requests and health checks.
 */
function doGet(e) {
  return jsonResponse({ status: "Temple Shalom Survey endpoint is running." });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
