@echo off
setlocal
title Touchline Vale - install on BlueStacks
cd /d "%~dp0"

set "APK=%CD%\Touchline-Vale-1.0.13-universal-debug.apk"
if not exist "%APK%" (
  echo ERROR: Touchline-Vale-1.0.13-universal-debug.apk not found in this folder:
  echo   %CD%
  pause
  exit /b 1
)

echo == APK under test ==
for %%A in ("%APK%") do echo   file : %%~fA
for %%A in ("%APK%") do echo   size : %%~zA bytes   ^(expected 358369^)
echo   expected SHA256: 22eb095a7e3ab22759084c16f439aba385db4ff94f82316e64aa1776e0689dd4
certutil -hashfile "%APK%" SHA256 | findstr /i /v "hash CertUtil"
echo.

rem ---------------------------------------------------------------- find adb
rem NOTE: we pushd into the tool folder and call the .exe by bare name.
rem Any ADB path containing spaces breaks when it is embedded in a for /f
rem command string, so never put the full path in a variable.
set "BTDIR="
if exist "%ProgramFiles%\BlueStacks_nxt\HD-Adb.exe"          set "BTDIR=%ProgramFiles%\BlueStacks_nxt"
if not defined BTDIR if exist "%ProgramFiles%\BlueStacks\HD-Adb.exe"       set "BTDIR=%ProgramFiles%\BlueStacks"
if not defined BTDIR if exist "%ProgramFiles(x86)%\BlueStacks_nxt\HD-Adb.exe" set "BTDIR=%ProgramFiles(x86)%\BlueStacks_nxt"
if not defined BTDIR if exist "%ProgramFiles(x86)%\BlueStacks\HD-Adb.exe"  set "BTDIR=%ProgramFiles(x86)%\BlueStacks"
if not defined BTDIR if exist "%ProgramData%\BlueStacks_nxt\HD-Adb.exe"    set "BTDIR=%ProgramData%\BlueStacks_nxt"

if defined BTDIR (
  echo == adb : %BTDIR%\HD-Adb.exe
  pushd "%BTDIR%"
  set "ADB=HD-Adb.exe"
) else (
  where adb >nul 2>nul
  if errorlevel 1 (
    echo ERROR: no HD-Adb.exe and no adb on PATH.
    echo Install BlueStacks 5, or just drag the APK onto the running BlueStacks window.
    pause
    exit /b 1
  )
  echo == adb : from PATH
  set "ADB=adb"
)

rem ------------------------------------------------------- find the instance
set "DEV="
for %%P in (5555 5556 5565 5575 5585 5605) do (
  if not defined DEV (
    %ADB% connect 127.0.0.1:%%P >nul 2>nul
    %ADB% -s 127.0.0.1:%%P shell echo probe >nul 2>nul && set "DEV=127.0.0.1:%%P"
  )
)

if not defined DEV (
  echo.
  echo == devices adb can currently see ==
  %ADB% devices
  echo.
  echo No instance answered on ports 5555/5556/5565/5575/5585/5605.
  echo Checklist:
  echo   1. BlueStacks 5 is fully booted ^(desktop visible, not still loading^).
  echo   2. BlueStacks Settings -^> Advanced -^> "Android Debug Bridge" is ON.
  echo   3. If that toggle does not exist, use the Multi-instance Manager and
  echo      note the instance's ADB port, then run:
  echo          %ADB% connect 127.0.0.1:PORT
  echo   4. Easiest alternative: drag the APK file onto the BlueStacks window.
  popd
  pause
  exit /b 1
)

echo == device : %DEV%
echo == Android: %DEV%
%ADB% -s %DEV% shell getprop ro.build.version.release
%ADB% -s %DEV% shell getprop ro.build.version.sdk
%ADB% -s %DEV% shell getprop ro.product.cpu.abi
echo.

echo == installing (this can take a few seconds) ==
%ADB% -s %DEV% install -r "%APK%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo SUCCESS - installed.
  %ADB% -s %DEV% shell monkey -p com.touchlinevale.game -c android.intent.category.LAUNCHER 1 >nul 2>nul
  echo Launching Touchline Vale.
  echo If it opens to a black screen, that is BlueStacks' OpenGL, not the APK:
  echo   BlueStacks Settings -^> Graphics -^> Graphics renderer -^> OpenGL,
  echo   and set the instance to 4 cores / 4 GB RAM.
) else (
  echo Install failed, adb exit code %RC%. The INSTALL_FAILED_* text above is the cause:
  echo   INSTALL_FAILED_UPDATE_INCOMPATIBLE  -^>  %ADB% -s %DEV% uninstall com.touchlinevale.game   then rerun
  echo   INSTALL_FAILED_OLDER_SDK            -^>  the instance is older than Android 5.0
  echo   INSTALL_FAILED_INSUFFICIENT_STORAGE -^>  free space on the instance
  echo   INSTALL_PARSE_FAILED_*              -^>  damaged copy, check the SHA256 above
  echo   INSTALL_FAILED_NO_MATCHING_ABIS     -^>  wrong file, this APK has no native libs
)
popd
echo.
pause
