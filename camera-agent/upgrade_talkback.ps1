$ErrorActionPreference = "Stop"

$base = "https://raw.githubusercontent.com/neo-vision1/neo-stream/main/camera-agent"
$agent = Join-Path $env:LOCALAPPDATA "NeoVisionAgent"
$cloud = Join-Path $env:LOCALAPPDATA "NeoVisionCloudflareDeployV2"

if (-not (Test-Path (Join-Path $agent "config.json"))) {
    throw "Agent não encontrado em $agent"
}
if (-not (Test-Path (Join-Path $cloud "wrangler.jsonc"))) {
    throw "Projeto Cloudflare não encontrado em $cloud"
}

function Get-NeoFile([string]$Relative, [string]$Destination) {
    $parent = Split-Path $Destination -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Invoke-WebRequest -Uri "$base/$Relative" -OutFile $Destination
}

Write-Host "Parando o Agent..."
Stop-ScheduledTask -TaskName "NeoVisionCameraAgent" -ErrorAction SilentlyContinue

try {
    Write-Host "Atualizando o Agent sem alterar config.json ou chaves do Mux..."
    Get-NeoFile "agent/agent.py" (Join-Path $agent "agent.py")
    Get-NeoFile "agent/intelbras_talk.py" (Join-Path $agent "intelbras_talk.py")

    Write-Host "Atualizando o painel e o Worker..."
    foreach ($relative in @(
        "src/index.js",
        "src/protocol.js",
        "public/index.html",
        "public/app.js",
        "public/talk.js",
        "public/ui.js",
        "public/style.css"
    )) {
        Get-NeoFile "cloudflare/$relative" (Join-Path $cloud $relative)
    }

    Push-Location $cloud
    try {
        npx wrangler deploy
        if ($LASTEXITCODE -ne 0) { throw "Falha no wrangler deploy" }
    }
    finally {
        Pop-Location
    }
}
finally {
    Write-Host "Reiniciando o Agent..."
    Start-ScheduledTask -TaskName "NeoVisionCameraAgent" -ErrorAction SilentlyContinue
}

Write-Host "Atualização concluída. Recarregue o painel com Ctrl+F5."
