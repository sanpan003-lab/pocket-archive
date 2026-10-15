@echo off
setlocal EnableDelayedExpansion
rem ============================================================
rem   Pocket Archive - build + install the Android app
rem   1. bump versionCode / versionName (android\app\version.properties)
rem   2. build the signed release APK with the existing keystore
rem   3. copy it to Documents\PocketArchive.apk
rem   4. "adb install -r" on every connected phone (USB or Wi-Fi)
rem ============================================================

cd /d "%~dp0"

set KEYSTORE=C:\Users\sundi\keys\pocketarchive.jks
set EXPECTED_CERT=F4:41:B0:E3:7B:F5:10:40:73:9B:96:31:70:61:D1:71:F2:E1:C4:49:7F:79:D5:25:33:F3:12:06:5C:35:C7:21
set OUTPUT=C:\Users\sundi\Documents\PocketArchive.apk
set APK=android\app\build\outputs\apk\release\app-release.apk

if not defined JAVA_HOME set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
if not defined ANDROID_HOME set "ANDROID_HOME=C:\Users\sundi\AppData\Local\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"

echo ========================================
echo   Pocket Archive - Android release
echo ========================================
echo.

rem -- Signing key: use the existing one, never create a new key ---------
if not exist "%KEYSTORE%" (
  echo ERROR: Keystore not found: %KEYSTORE%
  echo Restore it from your backup. Do NOT create a new one - phones only accept
  echo updates signed with the original key.
  goto :fail
)
if not exist "android\keystore.properties" (
  echo ERROR: android\keystore.properties is missing ^(keystore passwords^).
  echo Restore it from your backup next to the keystore.
  goto :fail
)
if not exist ".env.android" (
  echo ERROR: .env.android is missing. Copy .env.android.example and set VITE_API_BASE_URL.
  goto :fail
)

echo [1/4] Building the app's web bundle + syncing Capacitor...
call npm run build:android
if errorlevel 1 goto :fail

echo.
echo [2/4] Building the signed release APK (bumps the version)...
pushd android
call .\gradlew.bat assembleRelease
set GRADLE_ERR=%errorlevel%
popd
if not "%GRADLE_ERR%"=="0" goto :fail
if not exist "%APK%" (
  echo ERROR: %APK% was not produced.
  goto :fail
)

for /f "tokens=1,* delims==" %%A in (android\app\version.properties) do (
  if "%%A"=="VERSION_NAME" set VERSION_NAME=%%B
  if "%%A"=="VERSION_CODE" set VERSION_CODE=%%B
)
echo Version !VERSION_NAME! ^(!VERSION_CODE!^)

rem -- Make sure it is signed with the original certificate ---------------
set APKSIGNER=
for /f "delims=" %%D in ('dir /b /ad /o-n "%ANDROID_HOME%\build-tools" 2^>nul') do (
  if not defined APKSIGNER if exist "%ANDROID_HOME%\build-tools\%%D\apksigner.bat" set "APKSIGNER=%ANDROID_HOME%\build-tools\%%D\apksigner.bat"
)
if defined APKSIGNER (
  set CERT=
  for /f "tokens=2 delims=:" %%L in ('call "!APKSIGNER!" verify --print-certs "%APK%" ^| findstr /c:"certificate SHA-256 digest"') do set "CERT=%%L"
  set "CERT=!CERT: =!"
  set "WANT=%EXPECTED_CERT::=%"
  if /i not "!CERT!"=="!WANT!" (
    echo ERROR: The APK is not signed with the Pocket Archive key ^(got "!CERT!"^).
    goto :fail
  )
  echo Signature OK ^(Pocket Archive release key^)
) else (
  echo Warning: apksigner not found - skipped the signature check.
)

echo.
echo [3/4] Copying to %OUTPUT%...
copy /y "%APK%" "%OUTPUT%" >nul
if errorlevel 1 goto :fail

echo.
echo [4/4] Installing on connected phones...
if not exist "%ADB%" (
  echo adb not found at %ADB% - install the APK manually.
  goto :done
)
set INSTALLED=0
for /f "skip=1 tokens=1,2" %%A in ('"%ADB%" devices') do (
  if "%%B"=="device" (
    set "SERIAL=%%A"
    if /i "!SERIAL:~0,9!"=="emulator-" (
      echo Skipping emulator !SERIAL!
    ) else (
      echo Installing on !SERIAL!...
      "%ADB%" -s !SERIAL! install -r "%OUTPUT%"
      if errorlevel 1 (
        echo Install failed on !SERIAL!
      ) else (
        set /a INSTALLED+=1
      )
    )
  )
  if "%%B"=="unauthorized" echo %%A is unauthorized - unlock the phone and accept the "Allow USB/wireless debugging" prompt.
)
if "!INSTALLED!"=="0" (
  echo No phone connected. Connect by USB, or over Wi-Fi with:  adb connect ^<phone-ip^>:^<port^>
  echo Then run:  "%ADB%" install -r "%OUTPUT%"
)

:done
echo.
echo Done: %OUTPUT%  ^(version !VERSION_NAME!, code !VERSION_CODE!^)
endlocal
exit /b 0

:fail
echo.
echo Android release FAILED.
endlocal
exit /b 1
