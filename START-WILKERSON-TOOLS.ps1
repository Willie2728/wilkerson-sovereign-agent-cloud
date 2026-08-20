$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Users\wilke\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $node)) { Write-Host 'Node.js was not found.' -ForegroundColor Yellow; Read-Host 'Press Enter'; exit 1 }

$ollama = 'D:\WilkersonAI\ollama\ollama.exe'
$modelPath = 'D:\WilkersonAI\models'
$logPath = 'D:\WilkersonAI\logs'
if (-not (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path -LiteralPath $ollama)) { Write-Host 'The Wilkerson local AI runtime was not found on drive D:.' -ForegroundColor Yellow; Read-Host 'Press Enter'; exit 1 }
    New-Item -ItemType Directory -Path $modelPath, $logPath -Force | Out-Null
    $env:OLLAMA_HOST = '127.0.0.1:11434'
    $env:OLLAMA_MODELS = $modelPath
    $env:OLLAMA_NO_CLOUD = 'true'
    $env:OLLAMA_NUM_PARALLEL = '1'
    $env:OLLAMA_MAX_LOADED_MODELS = '1'
    $env:OLLAMA_KEEP_ALIVE = '2m'
    Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'ollama-output.log') -RedirectStandardError (Join-Path $logPath 'ollama-error.log')
    Start-Sleep -Seconds 3
}

if (-not (Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $projectPath -WindowStyle Hidden
    Start-Sleep -Milliseconds 900
}
Start-Process 'http://127.0.0.1:8788/'
Write-Host 'Wilkerson Local AI Studio is running at http://127.0.0.1:8788/' -ForegroundColor Green
Write-Host 'Coding, vision, speech, crawler, and camera tools stay on this computer.' -ForegroundColor Green
