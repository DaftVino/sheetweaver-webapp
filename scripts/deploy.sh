#!/usr/bin/env bash
# Push and deploy the script to Google Apps Script.
# Usage:
#   ./scripts/deploy.sh                     # push + deploy with auto timestamp
#   ./scripts/deploy.sh "My description"    # push + deploy with custom message
#
# Requires: clasp authenticated (npx clasp login)

set -euo pipefail

DESCRIPTION="${1:-"Deployed $(date -u '+%Y-%m-%dT%H:%M:%SZ')"}"

echo "==> Pushing files to Apps Script..."
npx clasp push --force

echo "==> Creating deployment version: \"$DESCRIPTION\""
npx clasp deploy --description "$DESCRIPTION"

echo "==> Done. Run 'npx clasp deployments' to see the web app URL."
