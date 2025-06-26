<<<<<<< HEAD

cd /d "%~dp0"

node server.js

start "" "SteamProfileViewer.html"
=======
@echo off
cd /d "%~dp0"
start "" "SteamProfileViewer.html"  
start cmd /k "node server.js"   
>>>>>>> Feature
