param(
    [ValidatePattern("^CAM(0[1-9]|1[0-1])$")]
    [string]$CameraId = "CAM01"
)

$ErrorActionPreference = "Stop"
$taskName = "NeoVisionCameraAgent"
$agentDir = Join-Path $env:LOCALAPPDATA "NeoVisionAgent"
$configPath = Join-Path $agentDir "config.json"
$keysPath = Join-Path $agentDir "mux_keys.json"
$rawBase = "https://raw.githubusercontent.com/neo-vision1/neo-stream/main/camera-agent"

if (-not (Test-Path $configPath)) {
    throw "config.json não encontrado em $configPath"
}
if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
    throw "FFmpeg não encontrado. Confirme se 'ffmpeg -version' funciona."
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not ($config.cameras | Where-Object { $_.id -eq $CameraId })) {
    throw "$CameraId não encontrada no config.json"
}

$secureKey = Read-Host "Cole a Stream Key do Mux para $CameraId" -AsSecureString
$streamKey = [System.Net.NetworkCredential]::new("", $secureKey).Password
if ([string]::IsNullOrWhiteSpace($streamKey)) {
    throw "A Stream Key não pode ficar vazia"
}

$keys = [ordered]@{}
if (Test-Path $keysPath) {
    $currentKeys = Get-Content $keysPath -Raw | ConvertFrom-Json
    $currentKeys.PSObject.Properties | ForEach-Object { $keys[$_.Name] = $_.Value }
}
$keys[$CameraId] = $streamKey

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($keysPath, ($keys | ConvertTo-Json), $utf8NoBom)

foreach ($file in @("agent.py", "media_relay.py")) {
    & curl.exe -fL "$rawBase/agent/$file" -o (Join-Path $agentDir $file)
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $file" }
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Agent reiniciado pela tarefa automática." -ForegroundColor Green
} else {
    Write-Host "Tarefa automática não encontrada. Inicie: python $agentDir\agent.py" -ForegroundColor Yellow
}

Write-Host "$CameraId configurada para transmitir vídeo e áudio ao Mux." -ForegroundColor Green
Write-Host "Mantenha o RTMP nativo dessa câmera desativado."
Write-Host "Log do relay: $agentDir\logs\relay-$CameraId.log"
