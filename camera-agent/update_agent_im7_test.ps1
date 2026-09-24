param(
    [string]$Branch = "test/site-improvements-20260923"
)

$ErrorActionPreference = "Stop"
$agentDir = Join-Path $env:LOCALAPPDATA "NeoVisionAgent"
$configPath = Join-Path $agentDir "config.json"
$rawBase = "https://raw.githubusercontent.com/neo-vision1/neo-stream/$Branch/camera-agent/agent"

if (-not (Test-Path $configPath)) {
    throw "config.json não encontrado em $configPath"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $agentDir "config.backup-im7-$timestamp.json"
Copy-Item $configPath $backupPath

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not $config.cameras) {
    throw "Este atualizador requer o config.json atual com a lista 'cameras'"
}
$existing = @($config.cameras | Where-Object { $_.id -eq "CAM11" }) | Select-Object -First 1
if (-not $existing) { $existing = [pscustomobject]@{ id = "CAM11" } }

$securePassword = Read-Host "Chave de acesso da etiqueta da iM7+ (não será enviada à internet)" -AsSecureString
$credential = New-Object System.Management.Automation.PSCredential("admin", $securePassword)
$cameraPassword = $credential.GetNetworkCredential().Password
if (-not $cameraPassword) { throw "A chave de acesso é obrigatória" }

$values = [ordered]@{
    id = "CAM11"
    name = "iM7+ Zoom Full Color"
    ip = "192.168.1.108"
    ptzProtocol = "onvif"
    onvifPort = 80
    onvifAdjustTime = $true
    onvifPasswordDigest = $false
    username = "admin"
    password = $cameraPassword
    supportsZoom = $true
}
foreach ($entry in $values.GetEnumerator()) {
    $existing | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
}

$otherCameras = @($config.cameras | Where-Object { $_.id -ne "CAM11" })
$config.cameras = @($otherCameras) + @($existing)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8NoBom)
$cameraPassword = $null
$credential = $null

$files = @("agent.py", "onvif_camera.py", "requirements.txt", "test_im7_onvif.py")
$downloadDir = Join-Path $env:TEMP "NeoVisionIm7Update-$timestamp"
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
try {
    foreach ($file in $files) {
        & curl.exe -fL "$rawBase/$file" -o (Join-Path $downloadDir $file)
        if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $file" }
    }
    foreach ($file in $files) {
        Copy-Item (Join-Path $downloadDir $file) (Join-Path $agentDir $file) -Force
    }
} finally {
    Remove-Item $downloadDir -Recurse -Force -ErrorAction SilentlyContinue
}

Push-Location $agentDir
try {
    python -m pip install -r .\requirements.txt
    if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar as dependências do Agent" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Agent preparado para CAM11 / 192.168.1.108." -ForegroundColor Green
Write-Host "Backup: $backupPath"
Write-Host "Agora execute: cd `$env:LOCALAPPDATA\NeoVisionAgent; python .\test_im7_onvif.py" -ForegroundColor Cyan
