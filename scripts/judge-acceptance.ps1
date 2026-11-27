<#
.SYNOPSIS
  Owner acceptance test for OMP Genie's consent-gated independent judge.

.DESCRIPTION
  Copies the disposable `docs-drift` fixture to a temporary directory, starts the
  real interactive OMP TUI with this repository's extension, and asks the owner to
  run `/genie` and decide the consent dialog themselves. After OMP exits, the
  script reads the session record and reports the actual judge attribution,
  answer-id validation, and usage. It never calls the judge itself.

  This is deliberately not headless: the consent dialog and the real configured
  judge are part of the test. Use a disposable fixture, never private material.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\judge-acceptance.ps1
#>
[CmdletBinding()]
param(
    [string]$RepoPath = "",
    [string]$FixturePath = "",
    [string]$SessionDir = "",
    [string]$OmpPath = "omp"
)

$ErrorActionPreference = "Stop"
if ($RepoPath -eq "") {
    $RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit 1
}

$omp = Get-Command $OmpPath -ErrorAction SilentlyContinue
if (-not $omp) { Fail "OMP executable not found: $OmpPath" }
$version = (& $OmpPath --version 2>&1 | Out-String).Trim()
if (-not $version) { Fail "omp --version returned nothing." }

$extension = Join-Path $RepoPath "src\extension.ts"
if (-not (Test-Path $extension)) { Fail "extension not found: $extension" }

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("omp-genie-judge-" + [guid]::NewGuid().ToString("N"))
$fixture = if ($FixturePath -ne "") { (Resolve-Path $FixturePath).Path } else { Join-Path $RepoPath "evals\fixtures\docs-drift" }
$session = if ($SessionDir -ne "") { $SessionDir } else { Join-Path $tempRoot "sessions" }
$fixtureCopy = Join-Path $tempRoot "project"

New-Item -ItemType Directory -Force -Path $fixtureCopy, $session | Out-Null
Copy-Item -Path (Join-Path $fixture "*") -Destination $fixtureCopy -Recurse -Force

Write-Host ""
Write-Host "OMP Genie judge acceptance test" -ForegroundColor Cyan
Write-Host "  OMP:      $version"
Write-Host "  Fixture:  $fixtureCopy"
Write-Host "  Sessions: $session"
Write-Host ""
Write-Host "In the OMP TUI:" -ForegroundColor Yellow
Write-Host "  1. Run: /genie"
Write-Host "  2. Read the consent dialog. Approve only if you accept the destinations and payload."
Write-Host "  3. Wait for the report, then exit OMP (/quit or Ctrl+C)."
Write-Host ""
Read-Host "Press Enter to launch OMP"

Push-Location $fixtureCopy
try {
    & $OmpPath --session-dir $session -e $extension
} finally {
    Pop-Location
}

$sessionFiles = Get-ChildItem -Path $session -Filter "*.jsonl" -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
if (-not $sessionFiles) { Fail "No session JSONL was written under $session" }

$report = $null
foreach ($file in $sessionFiles) {
    foreach ($line in Get-Content -LiteralPath $file.FullName) {
        if ($line -notmatch 'genie-report') { continue }
        try {
            $entry = $line | ConvertFrom-Json
        } catch {
            continue
        }
        $candidate = $null
        if ($null -ne $entry.message -and $null -ne $entry.message.content) {
            $candidate = $entry.message.content
        } elseif ($null -ne $entry.content) {
            $candidate = $entry.content
        }
        if ($candidate -is [array]) {
            $candidate = ($candidate | ForEach-Object { if ($_.text) { $_.text } }) -join "`n"
        }
        if ($candidate -is [string] -and $candidate.Contains("# OMP Genie")) {
            $report = $candidate
            break
        }
    }
    if ($report) { break }
}
if (-not $report) { Fail "No Genie report row found. Did /genie complete? Sessions: $session" }

function Match-One([string]$Pattern, [string]$Label) {
    $match = [regex]::Match($report, $Pattern)
    if (-not $match.Success) { return $null }
    return $match.Groups[1].Value.Trim()
}

$mainModel = Match-One '\*\*Main model:\*\* (.+)\.' "main model"
$judge = Match-One '\*\*Independent judgement used:\*\* (.+)\.' "judge"
$notJudged = Match-One '\*\*Independent judgement:\*\* NOT INDEPENDENTLY JUDGED — (.+)\.' "degraded reason"
$answerIds = Match-One '- Answer ids: (\d+) expected, all present and validated\.' "answer ids"
$usage = Match-One '- Usage: (.+)\. Not included' "usage"
$impact = [regex]::IsMatch($report, '- Impact score: .*?Advisory/display-only')

$record = [ordered]@{
    recordedAt = (Get-Date).ToUniversalTime().ToString("o")
    ompVersion = $version
    fixture = $fixtureCopy
    mainModel = $mainModel
    judge = $judge
    degradedReason = $notJudged
    answerIds = $answerIds
    validation = if ($answerIds) { "all_answer_ids_present" } else { "not_validated" }
    usage = $usage
    impactAdvisoryLabelPresent = [bool]$impact
    report = $report
}

$outDir = Join-Path $RepoPath "evals\.runs"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ssZ")
$jsonPath = Join-Path $outDir "judge-acceptance-$stamp.json"
$mdPath = Join-Path $outDir "judge-acceptance-$stamp.md"
$record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$lines = @(
    "# Judge acceptance record",
    "",
    "Recorded: $($record.recordedAt)",
    "OMP: $($record.ompVersion)",
    "Main model: $($record.mainModel)",
    "Judge: $($record.judge)",
    "Degraded reason: $($record.degradedReason)",
    "Answer ids: $($record.answerIds)",
    "Validation: $($record.validation)",
    "Usage: $($record.usage)",
    "",
    "The report is stored verbatim in the JSON record. This file is outside the repository's tracked docs."
)
$lines | Set-Content -LiteralPath $mdPath -Encoding UTF8

Write-Host ""
Write-Host "Record: $jsonPath" -ForegroundColor Green
Write-Host "Summary: $mdPath" -ForegroundColor Green
if (-not $judge -or -not $answerIds) {
    Write-Host "NOT INDEPENDENTLY JUDGED / NOT VALIDATED: $($notJudged)" -ForegroundColor Yellow
    exit 2
}
Write-Host "PASS: judge reported provider/model/api and all answer ids validated." -ForegroundColor Green
