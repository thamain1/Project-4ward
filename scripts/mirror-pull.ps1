# =============================================================================
# mirror-pull.ps1 — pull the Mnemosyne memory mirror onto THIS (remote) machine.
# Brings MEMORY.md + topic files + CLAUDE.md (the operating strategy) down from the
# shared brain into this machine's Claude Code memory. Secrets arrive as
# {{VAULTED → get_secret('id')}} pointers (no plaintext); retrieve actual values via
# the Mnemosyne MCP get_secret tool when needed.
#
# Run from the repo's scripts\ folder:
#   .\mirror-pull.ps1                 # safe: restore to a staging dir + review (no overwrite)
#   .\mirror-pull.ps1 -Apply          # also copy into ~/.claude (backs up first)
#   .\mirror-pull.ps1 -Apply -MemoryDir "C:\Users\you\.claude\projects\c--Dev\memory"
#
# Prereqs (already true if you ran setup-mnemosyne-mcp.ps1): repo cloned, mcp\.env.local
# present (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), Node + git installed.
# =============================================================================
param(
  [switch]$Apply,
  [string]$MemoryDir = "$env:USERPROFILE\.claude\projects\c--Dev\memory",
  [string]$ClaudeMd  = "$env:USERPROFILE\.claude\CLAUDE.md"
)
$ErrorActionPreference = 'Stop'

# repo root = parent of this scripts\ folder
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
Write-Host "repo: $RepoRoot" -ForegroundColor Cyan

if (-not (Test-Path 'mcp\.env.local')) { Write-Error "mcp\.env.local not found — run setup-mnemosyne-mcp.ps1 first." }

# 1. get the latest code + restore logic
Write-Host "Pulling latest repo..." -ForegroundColor Cyan
git pull --ff-only

# 2. ensure @supabase/supabase-js is available to the scripts (root deps, from lockfile)
if (-not (Test-Path 'node_modules\@supabase\supabase-js')) {
  Write-Host "Installing root deps (npm ci, from lockfile)..." -ForegroundColor Cyan
  npm ci
}

# 3. restore the mirror into a STAGING dir (never overwrites in this step)
$Staging = Join-Path $RepoRoot '.mirror-restore'
$env:MIRROR_RESTORE_DIR = $Staging
Write-Host "Restoring mirror -> $Staging" -ForegroundColor Cyan
node --env-file=mcp/.env.local scripts/mirror-restore.mjs
if ($LASTEXITCODE -ne 0) { Write-Error "restore reported a failure — not copying anything. Investigate above." }

if (-not $Apply) {
  Write-Host ""
  Write-Host "DRY RUN complete. Review the files in:" -ForegroundColor Yellow
  Write-Host "  $Staging\CLAUDE.md  and  $Staging\memory\" -ForegroundColor Yellow
  Write-Host "When satisfied, re-run with -Apply to copy them into ~/.claude (a backup is made first)." -ForegroundColor Yellow
  exit 0
}

# 4. APPLY — back up the remote's current files, then copy the restored ones in
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (Test-Path $ClaudeMd) { Copy-Item $ClaudeMd "$ClaudeMd.bak-$stamp"; Write-Host "backed up CLAUDE.md -> $ClaudeMd.bak-$stamp" }
if (Test-Path $MemoryDir) {
  $memBak = "$MemoryDir.bak-$stamp"
  Copy-Item $MemoryDir $memBak -Recurse; Write-Host "backed up memory -> $memBak"
} else {
  New-Item -ItemType Directory -Force -Path $MemoryDir | Out-Null
}

if (Test-Path "$Staging\CLAUDE.md") { Copy-Item "$Staging\CLAUDE.md" $ClaudeMd -Force; Write-Host "wrote $ClaudeMd" -ForegroundColor Green }
Copy-Item "$Staging\memory\*" $MemoryDir -Recurse -Force
Write-Host "wrote memory files -> $MemoryDir" -ForegroundColor Green

Write-Host ""
Write-Host "DONE. Next:" -ForegroundColor Green
Write-Host "  1. Restart Claude Code on this machine so it loads the new CLAUDE.md + memory." -ForegroundColor Green
Write-Host "  2. Secrets in memory are {{VAULTED → get_secret('id')}} pointers — fetch real values via the Mnemosyne MCP get_secret tool." -ForegroundColor Green
Write-Host "  3. Hooks (H1 contracts-block, H2/H3) are NOT in the mirror — copy ~/.claude/hooks + settings.json separately if you want hard enforcement here." -ForegroundColor Green
