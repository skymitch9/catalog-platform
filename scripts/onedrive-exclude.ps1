<#
.SYNOPSIS
  Stop OneDrive from syncing dev clutter (node_modules, .claude) by moving those
  folders OUT of OneDrive and leaving a directory JUNCTION in their place.

.WHY
  OneDrive has no "don't sync this nested folder" button. But it ignores
  reparse points (junctions/symlinks). So: move node_modules / .claude to a
  twin folder outside OneDrive (same NTFS volume => an instant rename, no copy),
  then junction it back. Git, Node, and Claude Code all see the folder normally;
  OneDrive skips it and reclaims the cloud space. Reversible (see -Undo).

.NOTES
  - Same-volume move only (C: -> C:). Cross-volume would copy; this script refuses.
  - Idempotent: already-junctioned folders are skipped.
  - In-use folders (a running dev server / build holding node_modules) are skipped
    and reported, never forced.
  - Run it after cloning ANY new repo under -Root, or on a schedule.

.EXAMPLE
  # exclude everything under the default repos root
  powershell -ExecutionPolicy Bypass -File .\onedrive-exclude.ps1

.EXAMPLE
  # one repo only
  .\onedrive-exclude.ps1 -Root "C:\Users\nbasl\OneDrive\Documents\vs-code-repos\bookbuddy\library_catalog"

.EXAMPLE
  # put it all back (remove junctions, move contents home)
  .\onedrive-exclude.ps1 -Undo
#>
param(
  [string]$Root = "C:\Users\nbasl\OneDrive\Documents\vs-code-repos",
  [string]$Base = "C:\lcw\onedrive-excluded",
  [string[]]$Names = @('node_modules', '.claude'),
  [switch]$Undo
)

$ErrorActionPreference = 'Stop'
$rootFull = (Resolve-Path $Root).Path

function Is-Junction($p) { $i = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; return ($i -and $i.LinkType) }

if ($Undo) {
  # Re-hydrate: for every junction we made, delete the link and move contents home.
  $links = Get-ChildItem $rootFull -Recurse -Directory -Force -Depth 6 -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in $Names -and (Is-Junction $_.FullName) }
  foreach ($l in $links) {
    $target = (Get-Item -LiteralPath $l.FullName -Force).Target
    if (-not $target -or -not (Test-Path -LiteralPath $target)) { Write-Host "  SKIP (no target) $($l.FullName)"; continue }
    cmd /c "rmdir `"$($l.FullName)`"" | Out-Null     # remove the junction link only (not the target's files)
    Move-Item -LiteralPath $target -Destination $l.FullName
    Write-Host "  RESTORED $($l.FullName)"
  }
  Write-Host "Undo complete."
  return
}

# Only volume C: is safe for an instant rename.
if ((Split-Path $rootFull -Qualifier) -ne (Split-Path $Base -Qualifier)) {
  throw "Root ($rootFull) and Base ($Base) must be on the same volume for a no-copy move."
}

$cands = Get-ChildItem $rootFull -Recurse -Directory -Force -Depth 6 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -in $Names -and
    $_.FullName -notmatch '\\node_modules\\' -and   # top-level only, never a nested node_modules
    $_.FullName -notlike "$Base*" -and
    -not (Is-Junction $_.FullName)
  }

$moved = 0; $gb = 0.0; $skip = @()
foreach ($t in $cands) {
  $rel = $t.FullName.Substring($rootFull.Length).TrimStart('\')
  $dst = Join-Path $Base $rel
  try {
    $sz = (Get-ChildItem $t.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
    Move-Item -LiteralPath $t.FullName -Destination $dst          # instant same-volume rename
    New-Item -ItemType Junction -Path $t.FullName -Target $dst | Out-Null
    $moved++; $gb += $sz / 1GB
    Write-Host ("  OK  {0}  ({1} MB)" -f $rel, [math]::Round($sz/1MB, 0))
  } catch {
    $skip += "$rel : $($_.Exception.Message)"
  }
}
Write-Host ("=== moved {0} folders, freed {1} GB from OneDrive ===" -f $moved, [math]::Round($gb, 2))
if ($skip) { Write-Host "SKIPPED (in use / error) - rerun after closing them:"; $skip | ForEach-Object { Write-Host "  - $_" } }
