#!/usr/bin/env bash
# Pre-deploy pipeline test for the Temple Shalom survey.
#
# Tests all three stages of the submission pipeline:
#   1. Worker /health  — is the Worker up? Are Sheets secrets configured?
#   2. Apps Script direct POST — does the webhook accept the token and
#      append a row to the Sheet? (bypasses the Worker entirely)
#   3. Full end-to-end — POST through the Worker, verify D1 saved and
#      the Sheets dual-write did not error.
#
# Usage:
#   ./test_pipeline.sh              # run all stages
#   ./test_pipeline.sh --no-sheets  # skip stage 2 (Apps Script direct)
#
# Requires .env with: WORKER_URL, GS_WEBHOOK_URL, GS_WEBHOOK_TOKEN
# Optional:          EXPORT_KEY (for CSV row verification)

set -euo pipefail
source "$(dirname "$0")/.env"

WORKER_URL="${WORKER_URL:-https://temple-shalom-survey.jeffstein.workers.dev}"
RUN_SHEETS=true
if [[ "${1:-}" == "--no-sheets" ]]; then
  RUN_SHEETS=false
fi

STAMP="$(date -u +%Y%m%dT%H%M%S)"
PASS=0
FAIL=0
SKIP=0

# ── Helpers ──────────────────────────────────────────────────────────────────
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

ok()   { green "  [PASS] $*"; PASS=$((PASS+1)); }
fail() { red   "  [FAIL] $*"; FAIL=$((FAIL+1)); }
skip() { yellow "  [SKIP] $*"; SKIP=$((SKIP+1)); }

section() { echo ""; bold "=== $* ==="; }

# Apps Script web apps return a 302 redirect after POST. curl -L follows
# it but converts POST to GET, which returns a "Page Not Found" HTML page.
# Instead, capture the Location header and GET it manually.
# Usage: gs_post_result=$(apps_script_post "$URL" "$JSON_BODY")
apps_script_post() {
  local url="$1"
  local body="$2"
  local redirect
  redirect=$(curl -sS -i --max-time 15 -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null \
    | grep -i '^location:' | sed 's/^location: //I' | tr -d '\r')
  if [[ -z "$redirect" ]]; then
    echo "NO_REDIRECT"
    return
  fi
  curl -sS --max-time 20 "$redirect" 2>/dev/null || echo "CURL_FAILED"
}

# ── Stage 1: Worker health ───────────────────────────────────────────────────
section "Stage 1: Worker health"

HEALTH=$(curl -sf --max-time 10 "$WORKER_URL/health" 2>/dev/null) || {
  fail "Worker /health unreachable at $WORKER_URL"
  echo ""
  echo "Summary: $PASS passed, $FAIL failed, $SKIP skipped"
  exit 1
}

SHEETS_CFG=$(echo "$HEALTH" | grep -o '"sheets_configured":[a-z]*' | cut -d: -f2)
RESP_COUNT=$(echo "$HEALTH" | grep -o '"responses":[0-9]*' | cut -d: -f2)

ok "Worker is up — $RESP_COUNT responses in D1"

if [[ "$SHEETS_CFG" == "true" ]]; then
  ok "Sheets secrets configured (GS_WEBHOOK_URL + GS_WEBHOOK_TOKEN present)"
else
  fail "Sheets secrets NOT configured — run: npx wrangler secret put GS_WEBHOOK_URL && npx wrangler secret put GS_WEBHOOK_TOKEN"
fi

# ── Stage 2: Apps Script direct POST ─────────────────────────────────────────
section "Stage 2: Apps Script webhook (direct)"

if [[ "$RUN_SHEETS" != "true" ]]; then
  skip "Stage 2 skipped (--no-sheets)"
elif [[ -z "${GS_WEBHOOK_URL:-}" || -z "${GS_WEBHOOK_TOKEN:-}" ]]; then
  fail "GS_WEBHOOK_URL or GS_WEBHOOK_TOKEN not set in .env"
else
  # 2a: GET health check on the webhook
  GS_GET=$(curl -sf -L --max-time 10 "$GS_WEBHOOK_URL" 2>/dev/null) || {
    fail "Apps Script GET failed — webhook URL not reachable"
  }
  if echo "$GS_GET" | grep -q "endpoint is running"; then
    ok "Apps Script doGet works — endpoint is running"
  else
    fail "Apps Script doGet returned unexpected response: ${GS_GET:0:80}"
  fi

  # 2b: POST with WRONG token — should return {"success":false,"error":"Unauthorized"}
  echo "  Testing token validation (wrong token)..."
  GS_BAD=$(apps_script_post "$GS_WEBHOOK_URL" "{\"webhook_token\":\"WRONG\",\"response_id\":\"bad-$STAMP\"}")

  if echo "$GS_BAD" | grep -q '"success":false'; then
    ok "Token validation works — wrong token rejected"
  elif echo "$GS_BAD" | grep -q "Page Not Found"; then
    fail "Apps Script doPost not executing — check deployment type is 'Web app' and code includes doPost()"
  elif [[ "$GS_BAD" == "NO_REDIRECT" ]]; then
    fail "Apps Script POST returned no redirect — doPost may not exist"
  elif [[ "$GS_BAD" == "CURL_FAILED" ]]; then
    fail "Apps Script POST timed out or failed — doPost may be hanging"
  else
    fail "Unexpected response to wrong token: ${GS_BAD:0:80}"
  fi

  # 2c: POST with CORRECT token — should return {"success":true}
  echo "  Testing valid submission (correct token)..."
  GS_GOOD=$(apps_script_post "$GS_WEBHOOK_URL" "{
      \"webhook_token\":\"$GS_WEBHOOK_TOKEN\",
      \"response_id\":\"pipeline-test-$STAMP\",
      \"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"session_id\":\"test-session-$STAMP\",
      \"survey_version\":\"pipeline-test\",
      \"ip_country\":\"US\",
      \"cf_ray\":\"test-ray\",
      \"completion_seconds\":42,
      \"sections_answered\":1,
      \"user_agent\":\"test_pipeline.sh\",
      \"q_nps\":9,
      \"q28_final_comments\":\"Automated pipeline test — safe to delete.\"
    }")

  if echo "$GS_GOOD" | grep -q '"success":true'; then
    ok "Apps Script doPost accepted submission — row appended to Sheet"
  elif echo "$GS_GOOD" | grep -q "Page Not Found"; then
    fail "Apps Script doPost not executing — check deployment type is 'Web app' and code includes doPost()"
  elif [[ "$GS_GOOD" == "NO_REDIRECT" ]]; then
    fail "Apps Script POST returned no redirect — doPost may not exist"
  elif [[ "$GS_GOOD" == "CURL_FAILED" ]]; then
    fail "Apps Script POST timed out — doPost may be hanging (check Sheet ID, permissions)"
  else
    fail "Unexpected response: ${GS_GOOD:0:120}"
  fi
fi

# ── Stage 3: Full end-to-end through Worker ──────────────────────────────────
section "Stage 3: Full end-to-end (Worker -> D1 + Sheets)"

E2E_RESPONSE=$(curl -sS --max-time 30 -X POST "$WORKER_URL/submit" \
  -H "Content-Type: application/json" \
  -d "{
    \"_test\": true,
    \"timestamp\": \"E2E-$STAMP\",
    \"_session\": \"test-session-$STAMP\",
    \"_referrer\": \"https://example.com/test\",
    \"q5_religious_identity\": \"just_jewish\",
    \"q_nps\": 9,
    \"q28_final_comments\": \"Automated E2E pipeline test — safe to delete.\"
  }" 2>/dev/null || echo "CURL_FAILED")

if echo "$E2E_RESPONSE" | grep -q '"success":true'; then
  RESPONSE_ID=$(echo "$E2E_RESPONSE" | grep -o '"response_id":"[^"]*"' | cut -d'"' -f4)
  ok "Worker accepted submission — response_id: $RESPONSE_ID"
  ok "D1 write succeeded (Worker returned success)"
else
  fail "Worker /submit failed: ${E2E_RESPONSE:0:120}"
  echo ""
  echo "Summary: $PASS passed, $FAIL failed, $SKIP skipped"
  exit 1
fi

# ── Stage 3b: Re-submission linking ──────────────────────────────────────────
echo "  Testing re-submission linking (same session_id)..."
E2E_RESPONSE2=$(curl -sS --max-time 30 -X POST "$WORKER_URL/submit" \
  -H "Content-Type: application/json" \
  -d "{
    \"_test\": true,
    \"timestamp\": \"E2E2-$STAMP\",
    \"_session\": \"test-session-$STAMP\",
    \"_referrer\": \"https://example.com/test\",
    \"q5_religious_identity\": \"reform\",
    \"q_nps\": 7,
    \"q28_final_comments\": \"Automated re-submission test — safe to delete.\"
  }" 2>/dev/null || echo "CURL_FAILED")

if echo "$E2E_RESPONSE2" | grep -q '"success":true'; then
  RESPONSE_ID2=$(echo "$E2E_RESPONSE2" | grep -o '"response_id":"[^"]*"' | cut -d'"' -f4)
  ok "Re-submission accepted — response_id: $RESPONSE_ID2"
  # Verify linking via /results (needs EXPORT_KEY in .env)
  if [[ -n "${EXPORT_KEY:-}" ]]; then
    RESULTS=$(curl -sS --max-time 10 "$WORKER_URL/results?key=$EXPORT_KEY" 2>/dev/null || echo "CURL_FAILED")
    if echo "$RESULTS" | grep -q "\"previous_response_id\":\"$RESPONSE_ID\""; then
      ok "Re-submission linked to previous (previous_response_id matches)"
    else
      fail "Re-submission linking failed — previous_response_id not set or mismatched"
    fi
    if echo "$RESULTS" | grep -q '"submission_number":2'; then
      ok "submission_number incremented to 2"
    else
      fail "submission_number not incremented — expected 2"
    fi
  else
    skip "Re-submission linking verification (EXPORT_KEY not in .env)"
  fi
else
  fail "Re-submission failed: ${E2E_RESPONSE2:0:120}"
fi

# Check Worker tail for Sheets write errors (best-effort, non-blocking)
if [[ "$RUN_SHEETS" == "true" && "$SHEETS_CFG" == "true" ]]; then
  # Query the Apps Script rows endpoint to verify the row landed
  echo "  Verifying row in Google Sheet..."
  sleep 2  # give Apps Script a moment to append
  SHEET_ROWS=$(curl -sS -L --max-time 15 \
    "$GS_WEBHOOK_URL?key=$GS_WEBHOOK_TOKEN&rows=3" 2>/dev/null || echo "CURL_FAILED")

  if echo "$SHEET_ROWS" | grep -q "$RESPONSE_ID"; then
    ok "Response row found in Google Sheet (response_id matched)"
  elif echo "$SHEET_ROWS" | grep -q '"totalRows"'; then
    TOTAL=$(echo "$SHEET_ROWS" | grep -o '"totalRows":[0-9]*' | cut -d: -f2)
    fail "Response row NOT found in last 3 Sheet rows (totalRows=$TOTAL) — may need more time or check Sheet manually"
  elif [[ "$SHEET_ROWS" == "CURL_FAILED" ]]; then
    fail "Could not query Sheet rows endpoint — check Apps Script deployment"
  else
    fail "Unexpected response from rows endpoint: ${SHEET_ROWS:0:80}"
  fi
else
  skip "Sheets dual-write check (secrets not configured or --no-sheets)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
bold "Summary: $PASS passed, $FAIL failed, $SKIP skipped"

if [[ $FAIL -gt 0 ]]; then
  red "PIPELINE TEST FAILED — see failures above"
  exit 1
else
  green "PIPELINE TEST PASSED"
  exit 0
fi
