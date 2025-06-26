@echo off
cd /d "%~dp0"
start "" "SteamProfileViewer.html"  
start cmd /k "node server.js"   
