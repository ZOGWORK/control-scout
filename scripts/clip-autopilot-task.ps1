# The clip autopilot's schedule on a Windows computer at home (docs/clip-autopilot.md): every 3 hours, from a clone of
# its own, it reads the frames of what the frame-read queue says is due and opens data PRs (scripts/clip-autopilot.ts).
#
#   powershell -ExecutionPolicy Bypass -File scripts/clip-autopilot-task.ps1            # install (or update)
#   powershell -ExecutionPolicy Bypass -File scripts/clip-autopilot-task.ps1 -Remove    # take it away
#   powershell -ExecutionPolicy Bypass -File scripts/clip-autopilot-task.ps1 -RunNow    # install, then start a run
#
# It runs as you, while you're signed in (the reader needs your git, gh and ssh sign-ins, and a session that can play
# YouTube). The clone is the autopilot's alone: nothing else should work in it.
param(
  [switch]$Remove,
  [switch]$RunNow,
  [string]$Clone = (Join-Path $env:USERPROFILE "control-scout-autopilot"),
  [string]$Tesseract = (Join-Path $env:USERPROFILE "frame-ocr\node_modules\tesseract.js\src\index.js"),
  [int]$EveryHours = 3
)
$ErrorActionPreference = "Stop"
$name = "Control Scout clip autopilot"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed the task '$name'. The clone at $Clone is left as it is."
  exit 0
}

if (-not (Test-Path (Join-Path $Clone ".git"))) {
  git clone https://github.com/ZOGWORK/control-scout.git $Clone
  if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
}
if (-not (Test-Path $Tesseract)) {
  # tesseract.js isn't one of the app's dependencies (the server never needs it): installed once beside it.
  npm install --prefix (Join-Path $env:USERPROFILE "frame-ocr") tesseract.js
  if ($LASTEXITCODE -ne 0) { throw "npm install tesseract.js failed: the task isn't installed" }
}
Push-Location $Clone
try {
  # A native command's failure doesn't stop the script on its own ($ErrorActionPreference covers cmdlets only): each
  # is checked, so a broken install never registers a task that fails every run.
  if (-not (Test-Path "node_modules")) {
    npm ci --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed: the task isn't installed" }
  }
  npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw "playwright install chromium failed: the task isn't installed" }
} finally { Pop-Location }

$tess = "file:///" + ($Tesseract -replace "\\", "/")
# The start (plain Node) brings the clone and its dependencies to main before the runner runs: npm ci can't replace
# node_modules under a running tsx on Windows.
$run = "Set-Location '$Clone'; `$env:TESSERACT_JS='$tess'; New-Item -ItemType Directory -Force .data\autopilot | Out-Null; node scripts/clip-autopilot-start.mjs *>> .data\autopilot\task.log"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"$run`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours $EveryHours)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Reads due recordings' frames and opens clip data PRs (scripts/clip-autopilot.ts in $Clone)" -Force | Out-Null
Write-Output "Installed '$name': every $EveryHours h from $Clone, log in $Clone\.data\autopilot\task.log (each run's own in .data\autopilot\runs)."
if ($RunNow) { Start-ScheduledTask -TaskName $name; Write-Output "Started a run now." }
