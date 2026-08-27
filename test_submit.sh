#!/usr/bin/env bash
# Test that survey responses reach the Cloudflare Worker + D1 database.
# Run before publishing: ./test_submit.sh

set -euo pipefail
source "$(dirname "$0")/.env"

WORKER_URL="${WORKER_URL:-https://temple-shalom-survey.jeffstein.workers.dev}"
TIMESTAMP="TEST-$(date -u +%Y%m%dT%H%M%S)"

echo "Checking worker health..."
HEALTH=$(curl -sf "$WORKER_URL/health") && echo "  Health: $HEALTH" || { echo "  Worker unreachable!"; exit 1; }

echo ""
echo "Sending test submission..."
RESPONSE=$(curl -s -X POST "$WORKER_URL/submit" \
  -H "Content-Type: application/json" \
  -d "{
    \"timestamp\": \"$TIMESTAMP\",
    \"_test\": true,
    \"q5_religious_identity\": \"just_jewish\",
    \"q_nps\": 9,
    \"q28_final_comments\": \"Automated test — safe to delete.\"
  }")

echo "  Response: $RESPONSE"

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo ""
  echo "SUCCESS — response saved to D1."
  echo ""
  echo "To view all responses:"
  echo "  CLOUDFLARE_API_TOKEN=\$CF_WORKER_TOKEN npx wrangler d1 execute temple-shalom-responses --remote --command 'SELECT id, timestamp, session_id FROM responses ORDER BY id DESC LIMIT 10'"
  echo ""
  echo "To export as CSV:"
  echo "  curl '$WORKER_URL/export' -o responses.csv"
else
  echo ""
  echo "FAILED — check worker logs:"
  echo "  CLOUDFLARE_API_TOKEN=\$CF_WORKER_TOKEN npx wrangler tail temple-shalom-survey"
  exit 1
fi
