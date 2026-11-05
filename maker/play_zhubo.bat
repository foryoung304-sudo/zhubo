@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist Data mkdir Data

set "RUNTIME_EXE="
if exist ".cli\UrhoXRuntime.exe" set "RUNTIME_EXE=.cli\UrhoXRuntime.exe"
if not defined RUNTIME_EXE if exist "..\..\maker-demo-clone\.cli\UrhoXRuntime.exe" set "RUNTIME_EXE=..\..\maker-demo-clone\.cli\UrhoXRuntime.exe"
if not defined RUNTIME_EXE if exist "..\maker-demo-clone\.cli\UrhoXRuntime.exe" set "RUNTIME_EXE=..\maker-demo-clone\.cli\UrhoXRuntime.exe"
if not defined RUNTIME_EXE (
    where UrhoXRuntime.exe >nul 2>nul
    if %ERRORLEVEL% equ 0 set "RUNTIME_EXE=UrhoXRuntime.exe"
)

if not defined RUNTIME_EXE (
    echo [ERROR] UrhoXRuntime.exe not found!
    echo Please make sure UrhoXRuntime.exe is installed in .cli\ or available in PATH.
    pause
    exit /b 1
)

echo [OK] Launching game via: %RUNTIME_EXE%
echo Parameters: main.lua -tapcode_dir=. -tool_mode
start "" "%RUNTIME_EXE%" main.lua -tapcode_dir=. -tool_mode
