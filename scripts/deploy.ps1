# Push and deploy the script to Google Apps Script.
# Usage:
#   .\scripts\deploy.ps1                        # push + deploy with auto timestamp
#   .\scripts\deploy.ps1 "My description"       # push + deploy with custom message
#
# Requires: clasp authenticated (npx clasp login)

param(
  [string]$Description = "Deployed $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
)

$ErrorActionPreference = 'Stop'

Write-Host "==> Pushing files to Apps Script..."
npx clasp push --force

Write-Host "==> Creating deployment version: `"$Description`""
npx clasp deploy --description $Description

Write-Host "==> Done. Run 'npx clasp deployments' to see the web app URL."
