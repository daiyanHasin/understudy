# Understudy - Android setup without Android Studio
# Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved.
#
# Installs only what Understudy needs: Android command-line tools, platform-tools (adb),
# the emulator and one system image, then creates a light virtual device "Understudy_Pixel".
# Everything comes from Google's official download server. Nothing else is changed except
# the ANDROID_HOME user variable.

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"
$Host.UI.RawUI.WindowTitle = "Understudy - Android setup"

function Step($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Done($code) { Write-Host ""; Read-Host "Press Enter to close"; exit $code }

try {
  Write-Host "Understudy - Android setup" -ForegroundColor Yellow
  Write-Host "Downloads about 1.5 GB. Keep this window open until it says Finished."

  if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    Write-Host "Java 17 or newer is required first: https://adoptium.net" -ForegroundColor Red
    Done 1
  }

  $sdk = $env:ANDROID_HOME
  if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
  if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
  New-Item -ItemType Directory -Force -Path $sdk | Out-Null
  Write-Host "SDK folder: $sdk"

  $sdkm = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"
  $avdm = Join-Path $sdk "cmdline-tools\latest\bin\avdmanager.bat"

  if (-not (Test-Path $sdkm)) {
    Step "Downloading Android command-line tools"
    $url = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    $zip = Join-Path $env:TEMP "understudy-cmdline-tools.zip"
    $tmp = Join-Path $env:TEMP "understudy-cmdline-tools"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $dest = Join-Path $sdk "cmdline-tools\latest"
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
    Move-Item (Join-Path $tmp "cmdline-tools") $dest
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
  }

  [Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdk, "User")
  $env:ANDROID_HOME = $sdk

  Write-Host ""
  Write-Host "Which Android version should the virtual device run?"
  Write-Host "  1) Android 13 - recommended, lighter and faster"
  Write-Host "  2) Android 14"
  Write-Host "  3) Android 12 - lightest, for older or slower PCs"
  $choice = Read-Host "Choose 1, 2 or 3 [1]"
  $api = @{ "2" = "34"; "3" = "31" }[$choice]
  if (-not $api) { $api = "33" }
  $image = "system-images;android-$api;google_apis;x86_64"

  Step "Accepting the Android SDK licences"
  ("y`n" * 40) | & $sdkm "--sdk_root=$sdk" --licenses | Out-Null

  Step "Installing platform-tools, emulator and $image (this is the long part)"
  & $sdkm "--sdk_root=$sdk" "platform-tools" "emulator" $image
  if ($LASTEXITCODE -ne 0) { throw "sdkmanager failed" }

  Step "Creating the virtual device Understudy_Pixel"
  $name = "Understudy_Pixel"
  "no" | & $avdm create avd -n $name -k $image -d "pixel_4" --force
  if ($LASTEXITCODE -ne 0) { throw "avdmanager failed" }

  # Light settings: 2 GB RAM, host keyboard, GPU on, quick boot
  $avdHome = $env:ANDROID_AVD_HOME
  if (-not $avdHome) { $avdHome = Join-Path $env:USERPROFILE ".android\avd" }
  $cfg = Join-Path $avdHome "$name.avd\config.ini"
  if (Test-Path $cfg) {
    $want = [ordered]@{
      "hw.ramSize" = "2048"; "vm.heapSize" = "256"; "hw.keyboard" = "yes";
      "hw.gpu.enabled" = "yes"; "hw.gpu.mode" = "auto"; "disk.dataPartition.size" = "4G";
      "fastboot.forceColdBoot" = "no"; "hw.audioInput" = "no"; "hw.audioOutput" = "no"
    }
    $lines = Get-Content $cfg | Where-Object { $k = ($_ -split "=", 2)[0].Trim(); -not $want.Contains($k) }
    foreach ($k in $want.Keys) { $lines += "$k=$($want[$k])" }
    Set-Content -Path $cfg -Value $lines -Encoding ASCII
  }

  Step "Finished"
  Write-Host "Close this window, restart Understudy, and start Understudy_Pixel on the Record tab." -ForegroundColor Green
  Write-Host "If the device does not start, turn on virtualization in BIOS and enable"
  Write-Host "'Windows Hypervisor Platform' in Windows Features, then restart the PC."
  Done 0
}
catch {
  Write-Host ""
  Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Check your internet connection and run it again from the Setup tab."
  Done 1
}
