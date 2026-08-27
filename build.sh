#!/usr/bin/env bash
# Runs during CF Pages build — stamps version info into version.json
set -euo pipefail

cat > version.json <<EOF
{
  "sha":    "${CF_PAGES_COMMIT_SHA:-dev}",
  "branch": "${CF_PAGES_BRANCH:-local}",
  "url":    "${CF_PAGES_URL:-http://localhost}",
  "date":   "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "Built version: $(cat version.json)"
