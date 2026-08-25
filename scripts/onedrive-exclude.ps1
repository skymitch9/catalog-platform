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
  - A destination that already exists is REFUSED, never moved into (F11). Two
    trees for one folder is a decision for a person, not for a script.
  - -Undo touches ONLY links that point under -Base, i.e. ones this script made
    (F10). A node_modules symlinked to a shared pnpm/npm store is left alone.
  - -Undo keeps going after a failure and reports what it could not restore,
    with the path the contents are stranded at (F18).
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

$baseFull = $Base.TrimEnd('\')

if ($Undo) {
  # Re-hydrate: for every junction WE made, delete the link and move contents home.
  #
  # WARNING - three things this loop got wrong until 2026-08-25 (review F10/F11/F18):
  #
  #  F10 It restored ANY reparse point named node_modules or .claude, not only
  #      ours. Is-Junction is just $_.LinkType truthiness, which is true for a
  #      symlink as well as a junction, and nothing checked where the link
  #      POINTED. A repo whose node_modules is a symlink into a shared pnpm/npm
  #      store, or a monorepo package linked to the root's node_modules, would
  #      have its link deleted and THE SHARED STORE MOVED BODILY INTO THAT ONE
  #      REPO - breaking every other consumer of it, while printing "RESTORED".
  #      The guard below is the whole fix: if the target does not live under
  #      $Base, this script did not create it and must not touch it.
  #
  #  F18 There was no try/catch, under $ErrorActionPreference = 'Stop'. A
  #      Move-Item that failed on the third of ten links (a file lock, a long
  #      path) threw with the junction ALREADY DELETED - that repo left with no
  #      node_modules and nothing pointing at the copy still sitting in $Base -
  #      and the remaining seven never touched. Each iteration is now wrapped,
  #      the failure names the stranded copy's path so it is findable by hand,
  #      and the rest of the links still get restored.
  $links = Get-ChildItem $rootFull -Recurse -Directory -Force -Depth 6 -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in $Names -and (Is-Junction $_.FullName) }
  $restored = 0; $undoSkip = @()
  foreach ($l in $links) {
    # Reset per iteration: the catch below reports it, and a stale value from
    # the previous link would send someone to the wrong folder.
    $target = $null
    try {
      # WARNING - in Windows PowerShell 5.1 `.Target` on a reparse point is a
      # string ARRAY (verified on this machine: System.String[]); PS 6+ returns
      # a plain string. `@(...)[0]` normalises both. It matters here and did not
      # before: `Test-Path`/`Move-Item` coerce a one-element array happily, but
      # `.StartsWith()` on an array THROWS - which, with the new catch, would
      # turn every link into a reported failure and restore nothing at all.
      $target = @((Get-Item -LiteralPath $l.FullName -Force).Target)[0]
      if (-not $target -or -not (Test-Path -LiteralPath $target)) {
        $undoSkip += "$($l.FullName) : no target on disk"
        Write-Host "  SKIP (no target) $($l.FullName)"
      }
      elseif (-not $target.StartsWith($baseFull, [StringComparison]::OrdinalIgnoreCase)) {
        # F10: ours or not? Only a link INTO $Base was made by this script.
        $undoSkip += "$($l.FullName) : not ours - points at $target"
        Write-Host "  SKIP (not ours) $($l.FullName) -> $target"
      }
      else {
        cmd /c "rmdir `"$($l.FullName)`"" | Out-Null   # remove the junction link only (not the target's files)
        Move-Item -LiteralPath $target -Destination $l.FullName
        $restored++
        Write-Host "  RESTORED $($l.FullName)"
      }
    } catch {
      # The link may already be gone at this point - say where the contents are.
      if ($target) { $where = $target } else { $where = "(target unknown; look under $baseFull)" }
      $undoSkip += "$($l.FullName) : $($_.Exception.Message) - contents may still be at $where"
      Write-Host "  FAILED $($l.FullName) : $($_.Exception.Message)"
      Write-Host "         contents may still be at $where"
    }
  }
  Write-Host ("Undo complete - {0} restored, {1} skipped." -f $restored, $undoSkip.Count)
  if ($undoSkip) {
    Write-Host "SKIPPED / FAILED:"
    $undoSkip | ForEach-Object { Write-Host "  - $_" }
  }
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
  # WARNING - F11 (2026-08-25): Move-Item onto a directory destination that
  # ALREADY EXISTS moves the source INSIDE it. Run this once, lose the
  # junction later (a git clean, a OneDrive repair, a fresh clone over the
  # path), let npm install recreate a real node_modules, run it again - and
  # the NEW tree lands at ...\node_modules\node_modules while the junction
  # points at the OLD one. Builds then resolve stale dependencies with no
  # error anywhere. Refuse, name it, and let a person decide which tree is
  # the real one.
  #
  # Checked BEFORE the try, so `continue` is a plain loop continue and never one
  # crossing a try/catch boundary.
  if (Test-Path -LiteralPath $dst) {
    $skip += "$rel : destination already exists at $dst - not moving (would nest inside it). Delete or rename that copy, then rerun."
    continue
  }
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
