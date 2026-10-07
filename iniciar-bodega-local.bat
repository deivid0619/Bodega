@echo off
rem Abre Bodega en este computador para probar sin tocar la app publicada:
rem el servidor (8090), la pagina (5190) y el navegador. Cada uno queda en su
rem ventana; para apagarlos, cierra esas ventanas.
title Bodega local
start "Bodega - servidor (8090)" cmd /k "cd /d "%~dp0backend" && venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8090"
start "Bodega - pagina (5190)" cmd /k "cd /d "%~dp0" && npm --prefix frontend run dev"
timeout /t 6 /nobreak >nul
start "" http://localhost:5190
