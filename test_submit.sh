#!/usr/bin/env bash
# Test that survey responses actually reach the Google Sheet.
# Run this before publishing: ./test_submit.sh

set -euo pipefail

source "$(dirname "$0")/.env"

TIMESTAMP="TEST-$(date -u +%Y%m%dT%H%M%S)"

PAYLOAD=$(cat <<EOF
{
  "timestamp": "$TIMESTAMP",
  "_test": true,
  "q1_tenure": {"lived_in_cs": "1_5yr", "been_member": "less_1yr"},
  "q5_religious_identity": "just_jewish",
  "q_nps": 9,
  "q28_final_comments": "Automated test submission — safe to delete this row."
}
EOF
)

echo "Sending test submission to Apps Script..."
echo "URL: $APPS_SCRIPT_URL"
echo ""

HTTP_STATUS=$(curl -s -o /tmp/survey_test_response.txt -w "%{http_code}" \
  -X POST \
  -H "Content-Type: text/plain" \
  -d "$PAYLOAD" \
  "$APPS_SCRIPT_URL")

RESPONSE=$(cat /tmp/survey_test_response.txt)

echo "HTTP status: $HTTP_STATUS"
echo "Response:    $RESPONSE"
echo ""

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "SUCCESS — check your Google Sheet for a row with timestamp: $TIMESTAMP"
  echo "Sheet: https://docs.google.com/spreadsheets/d/1U4yxBRCslfJtbCOx--HwfagQd0pu8Ys4G8H1FCmrBk4/edit"
else
  echo "WARNING — response did not confirm success. Check the Apps Script logs."
  echo "Tip: In script.google.com, go to Executions to see what happened."
  exit 1
fi
