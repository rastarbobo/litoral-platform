#requires -Version 5.1
<#
.SYNOPSIS
    Automated deploy script for Litoral Platform
.DESCRIPTION
    Asks for confirmation, then commits, pushes to GitHub, and deploys to Cloudflare.
.EXAMPLE
    .\scripts\pi-tools\deploy.ps1
#>

param(
    [switch]$Force,
    [string]$Message = "deploy: automated update"
)

$ErrorActionPreference = "Stop"

function Write-Header($text) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

# Step 1: Ask for confirmation (unless -Force)
if (-not $Force) {
    Write-Host "`n🚀 DEPLOYMENT WORKFLOW" -ForegroundColor Cyan
    Write-Host "This will:"
    Write-Host "  1. Stage all changes (git add -A)"
    Write-Host "  2. Commit with message: '$Message'"
    Write-Host "  3. Push to GitHub (origin main)"
    Write-Host "  4. Deploy to Cloudflare Workers"
    Write-Host ""
    $response = Read-Host "Proceed? (yes/no)"
    if ($response -ne "yes") {
        Write-Host "❌ Deploy cancelled." -ForegroundColor Red
        exit 1
    }
}

# Step 2: Commit & Push
Write-Header "STEP 1: Commit & Push to GitHub"
try {
    git add -A
    Write-Host "✅ Changes staged." -ForegroundColor Green

    # Check if there are changes to commit
    $status = git status --porcelain
    if (-not $status) {
        Write-Host "⚠️  No changes to commit." -ForegroundColor Yellow
        exit 0
    }

    git commit -m "$Message"
    Write-Host "✅ Changes committed." -ForegroundColor Green

    git push origin main
    Write-Host "✅ Pushed to GitHub." -ForegroundColor Green
} catch {
    Write-Host "❌ Git operation failed: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Deploy to Cloudflare
Write-Header "STEP 2: Deploy to Cloudflare"
try {
    # Check for required env vars
    if (-not $env:CLOUDFLARE_API_TOKEN) {
        Write-Host "⚠️  CLOUDFLARE_API_TOKEN not set in environment." -ForegroundColor Yellow
        Write-Host "   Please set it with: $env:CLOUDFLARE_API_TOKEN='...'" -ForegroundColor Yellow
        exit 1
    }

    pnpm run deploy
    Write-Host "✅ Deployed to Cloudflare!" -ForegroundColor Green
} catch {
    Write-Host "❌ Cloudflare deploy failed: $_" -ForegroundColor Red
    exit 1
}

# Step 4: Done
Write-Header "DEPLOYMENT COMPLETE"
Write-Host "🔗 GitHub:    https://github.com/rastarbobo/litoral-platform" -ForegroundColor Blue
Write-Host "☁️  Cloudflare: https://cloudflare-workers-nextjs-saas-template.rastarbogdan-9f5.workers.dev" -ForegroundColor Blue
Write-Host "`n🎉 Done!" -ForegroundColor Green`n