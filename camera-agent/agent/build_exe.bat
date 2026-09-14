@echo off
setlocal
py -m pip install -r requirements.txt
if errorlevel 1 goto :error
py -m PyInstaller --noconfirm --clean --onefile --name NeoVisionCameraAgent agent.py
if errorlevel 1 goto :error
echo.
echo Executavel criado em dist\NeoVisionCameraAgent.exe
pause
exit /b 0
:error
echo.
echo Falha ao gerar o executavel. Veja o erro acima.
pause
exit /b 1

