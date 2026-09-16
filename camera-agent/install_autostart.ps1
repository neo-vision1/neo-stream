$ErrorActionPreference = "Stop"

$taskName = "NeoVisionCameraAgent"
$agentDir = Join-Path $env:LOCALAPPDATA "NeoVisionAgent"
$agentPath = Join-Path $agentDir "agent.py"
$configPath = Join-Path $agentDir "config.json"
$runnerPath = Join-Path $agentDir "run_agent_hidden.ps1"

if (-not (Test-Path $agentPath)) {
    throw "agent.py não encontrado em $agentPath"
}
if (-not (Test-Path $configPath)) {
    throw "config.json não encontrado em $configPath"
}

$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    throw "Python não encontrado. Confirme se o comando 'python --version' funciona neste PowerShell."
}
$pythonPath = $pythonCommand.Source

$runningAgent = Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*agent.py*" } |
    Select-Object -First 1
if ($runningAgent) {
    throw "O Agent já está aberto. Feche a janela atual do Agent e execute este instalador novamente."
}

$runner = @"
`$ErrorActionPreference = "Stop"
Set-Location "$agentDir"
& "$pythonPath" "$agentPath" *>> "$agentDir\agent-autostart.log"
exit `$LASTEXITCODE
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($runnerPath, $runner, $utf8NoBom)

$actionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArguments -WorkingDirectory $agentDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Inicia o Neo Vision Camera Agent automaticamente após o login no Windows." `
    -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName

Write-Host ""
Write-Host "Inicialização automática habilitada." -ForegroundColor Green
Write-Host "Tarefa: $taskName"
Write-Host "Estado: $($task.State)"
Write-Host "Último resultado: $($info.LastTaskResult)"
Write-Host "Log: $agentDir\agent-autostart.log"
Write-Host "O Agent iniciará automaticamente após o login deste usuário no Windows."
