@echo off
title Stocky WhatsApp - Runner
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  [ERREUR] Node.js n'est pas installe sur ce poste.
    echo.
    echo  1. Telechargez Node.js LTS sur https://nodejs.org/  (bouton "LTS")
    echo  2. Pendant l'installation, laissez les options par defaut
    echo  3. Relancez ce fichier
    echo.
    pause
    exit /b 1
)

if not exist "config.json" (
    echo.
    echo  [CONFIG] Fichier config.json manquant.
    echo  Copiez config.example.json en config.json et remplissez-le
    echo  avec les valeurs affichees dans le Centre de connexion de Stocky.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installation des dependances - premiere fois, ~2-3 minutes...
    call npm install --omit=dev
)

echo.
echo  ================================================================
echo   Runner WhatsApp demarre. Laissez cette fenetre ouverte.
echo   Scannez le QR code depuis le Centre de connexion de Stocky.
echo   Fermer cette fenetre = arreter l'envoi.
echo  ================================================================
echo.
node runner.js
pause
