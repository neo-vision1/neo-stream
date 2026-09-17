$ErrorActionPreference = "Stop"

$agentDir = Join-Path $env:LOCALAPPDATA "NeoVisionAgent"
$cloudflareDir = Join-Path $env:LOCALAPPDATA "NeoVisionCloudflareDeployV2"
$configPath = Join-Path $agentDir "config.json"
$rawBase = "https://raw.githubusercontent.com/neo-vision1/neo-stream/main/camera-agent"

if (-not (Test-Path $configPath)) {
    throw "config.json não encontrado em $configPath"
}
New-Item -ItemType Directory -Force -Path $cloudflareDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $agentDir "config.backup-$timestamp.json"
Copy-Item $configPath $backupPath

$current = Get-Content $configPath -Raw | ConvertFrom-Json
if ($current.camera) {
    $sourceCamera = $current.camera
} elseif ($current.cameraDefaults) {
    $sourceCamera = $current.cameraDefaults
} else {
    throw "Não foi possível localizar as credenciais locais da câmera no config.json"
}

$ptzCodes = $sourceCamera.ptzCodes
if (-not $ptzCodes) {
    $ptzCodes = [ordered]@{ up = "Up"; down = "Down"; left = "Left"; right = "Right" }
}

$newConfig = [ordered]@{
    server = $current.server
    siteId = $current.siteId
    agentId = $current.agentId
    token = $current.token
    heartbeatSeconds = if ($current.heartbeatSeconds) { $current.heartbeatSeconds } else { 10 }
    movementTimeoutSeconds = if ($current.movementTimeoutSeconds) { $current.movementTimeoutSeconds } else { 2 }
    cameraDefaults = [ordered]@{
        scheme = if ($sourceCamera.scheme) { $sourceCamera.scheme } else { "http" }
        username = $sourceCamera.username
        password = $sourceCamera.password
        channel = 1
        verifyTls = [bool]$sourceCamera.verifyTls
        ptzCodes = $ptzCodes
    }
    cameras = @(
        [ordered]@{ id = "CAM01"; name = "Câmera 01"; ip = "192.168.1.17" }
        [ordered]@{ id = "CAM02"; name = "Câmera 02"; ip = "192.168.1.18" }
        [ordered]@{ id = "CAM03"; name = "Câmera 03"; ip = "192.168.1.16" }
        [ordered]@{ id = "CAM04"; name = "Câmera 04"; ip = "192.168.1.19" }
        [ordered]@{ id = "CAM05"; name = "Câmera 05"; ip = "192.168.1.2" }
        [ordered]@{ id = "CAM06"; name = "Câmera 06"; ip = "192.168.1.21" }
        [ordered]@{ id = "CAM07"; name = "Câmera 07"; ip = "192.168.1.13" }
        [ordered]@{ id = "CAM08"; name = "Câmera 08"; ip = "192.168.1.12" }
        [ordered]@{ id = "CAM09"; name = "Câmera 09"; ip = "192.168.1.22" }
        [ordered]@{ id = "CAM10"; name = "Câmera 10"; ip = "192.168.1.14" }
    )
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$json = $newConfig | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($configPath, $json, $utf8NoBom)

$agentFiles = @("agent.py", "intelbras_camera.py", "media_relay.py", "test_camera.py")
foreach ($file in $agentFiles) {
    $destination = Join-Path $agentDir $file
    & curl.exe -L "$rawBase/agent/$file" -o $destination
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $file" }
}

$cloudflareFiles = @(
    "package.json",
    "package-lock.json",
    "wrangler.jsonc",
    "src/index.js",
    "src/auth.js",
    "src/protocol.js",
    "public/index.html",
    "public/auth.js",
    "public/app.js",
    "public/style.css",
    "public/cameras.js",
    "public/ui.js",
    "public/logo-neo-vision.png"
)
foreach ($file in $cloudflareFiles) {
    $destination = Join-Path $cloudflareDir $file
    $destinationDir = Split-Path $destination -Parent
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    & curl.exe -L "$rawBase/cloudflare/$file" -o $destination
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $file" }
}

Push-Location $cloudflareDir
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "A instalação das dependências do Cloudflare falhou." }
    npx wrangler deploy
    if ($LASTEXITCODE -ne 0) { throw "A publicação do Cloudflare falhou." }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Atualização concluída." -ForegroundColor Green
Write-Host "Backup: $backupPath"
Write-Host "Câmeras com PTZ: CAM01, CAM02, CAM03, CAM04, CAM05, CAM06, CAM07, CAM08, CAM09 e CAM10"
Write-Host "Pendente de IP: CAM11"
Write-Host "Iniciando o Agent. Mantenha esta janela aberta." -ForegroundColor Cyan
Push-Location $agentDir
try {
    python .\agent.py
} finally {
    Pop-Location
}
