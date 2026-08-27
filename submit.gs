/**
 * Temple Shalom Member Survey 2025
 * Google Apps Script — Survey Submit Endpoint
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com and create a new project.
 * 2. Paste this entire file into the editor.
 * 3. Set SHEET_ID below to the ID of your Google Sheet
 *    (the long string in the Sheet's URL between /d/ and /edit).
 * 4. Click Deploy > New Deployment > Web App.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the deployment URL and paste it into index.html as SUBMIT_URL.
 */

const SHEET_ID   = "YOUR_GOOGLE_SHEET_ID_HERE";
const SHEET_NAME = "Responses";  // tab name inside the spreadsheet

/**
 * Handle incoming survey POST requests.
 */
function doPost(e) {
  try {
    const raw  = e.postData.contents;
    const data = JSON.parse(raw);

    const ss    = SpreadsheetApp.openById(SHEET_ID);
    let   sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    // Build ordered list of keys; timestamp always first
    const reservedKeys = ["timestamp"];
    const dataKeys     = Object.keys(data).filter(k => !reservedKeys.includes(k)).sort();
    const allKeys      = [...reservedKeys, ...dataKeys];

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
 * Allow browser preflight CORS requests.
 */
function doGet(e) {
  return jsonResponse({ status: "Temple Shalom Survey endpoint is running." });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
