# Understudy - install components, also behind company networks
# Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE.
#
# Started by Understudy.vbs / start-gui.bat on the first start (and with
# -CertsOnly when only the certificate file is missing).
#
# Why: company PCs often run an HTTPS-inspection client (Netskope, Zscaler,
# Forcepoint ...). It re-signs every HTTPS connection with the company's own
# root certificate. Windows trusts that certificate (IT installed it), but
# Node.js and npm only trust their built-in list, so `npm install` fails with
# SELF_SIGNED_CERT_IN_CHAIN or UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
#
# What this does (nothing is switched off, no "strict-ssl false"):
#   1. Writes tools\certs\company-ca.pem with
#        - the Netskope client's own certificate files, if Netskope is installed
#        - every certificate in this PC's "Trusted Root Certification Authorities"
#        - any .pem / .crt / .cer file you (or IT) put into tools\certs\
#   2. Runs npm install with NODE_EXTRA_CA_CERTS pointing at that file, so
#      Node trusts what Windows trusts. Understudy.vbs passes the same file to
#      Understudy itself (needed for "Install phone tools" and the AI helper).
#   3. Writes everything to logs\install.log and explains any failure.

param([switch]$CertsOnly)

$ErrorActionPreference = 'Continue'
$root    = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root 'tools\certs'
$bundle  = Join-Path $certDir 'company-ca.pem'
$logDir  = Join-Path $root 'logs'
$log     = Join-Path $logDir 'install.log'
New-Item -ItemType Directory -Force -Path $certDir, $logDir | Out-Null
Set-Location $root

function Add-Pem($sb, [byte[]]$raw) {
  [void]$sb.AppendLine('-----BEGIN CERTIFICATE-----')
  [void]$sb.AppendLine([Convert]::ToBase64String($raw, 'InsertLineBreaks'))
  [void]$sb.AppendLine('-----END CERTIFICATE-----')
}

function Write-CertBundle {
  $sb = New-Object System.Text.StringBuilder
  $n = 0
  # 1. Netskope keeps its certificates here
  $netskope = @(
    (Join-Path $env:ProgramData 'Netskope\STAgent\data\nscacert.pem'),
    (Join-Path $env:ProgramData 'Netskope\STAgent\data\nsrootcert.pem')
  )
  foreach ($f in $netskope) {
    if (Test-Path $f) { [void]$sb.AppendLine((Get-Content $f -Raw)); $n++ ; Write-Host "  + Netskope certificates: $f" }
  }
  # 2. Files added by hand (from IT): tools\certs\*.pem, *.crt, *.cer
  Get-ChildItem $certDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'company-ca.pem' -and $_.Extension -match '^\.(pem|crt|cer)$' } | ForEach-Object {
      try {
        $text = Get-Content $_.FullName -Raw -ErrorAction Stop
        if ($text -match 'BEGIN CERTIFICATE') { [void]$sb.AppendLine($text) }
        else { Add-Pem $sb (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $_.FullName).RawData }
        $n++; Write-Host "  + $($_.Name)"
      } catch { Write-Host "  ! Could not read $($_.Name): $($_.Exception.Message)" }
    }
  # 3. What Windows trusts (company inspection roots are installed here by IT)
  $roots = 0
  foreach ($store in 'Cert:\LocalMachine\Root', 'Cert:\CurrentUser\Root') {
    try {
      Get-ChildItem $store -ErrorAction Stop | Where-Object { $_.NotAfter -gt (Get-Date) } | ForEach-Object {
        Add-Pem $sb $_.RawData; $roots++
      }
    } catch {}
  }
  if ($roots) { Write-Host "  + $roots trusted root certificates from Windows"; $n++ }
  if ($n -gt 0) {
    [IO.File]::WriteAllText($bundle, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
    return $true
  }
  return $false
}

Write-Host ''
Write-Host ' Understudy - installing components' -ForegroundColor Cyan
Write-Host ' ===================================='
Write-Host ''
Write-Host ' Certificates (for company networks that inspect HTTPS):'
$haveBundle = Write-CertBundle
if ($haveBundle) { $env:NODE_EXTRA_CA_CERTS = $bundle; Write-Host "  = $bundle" }
else { Write-Host '  (none found - fine on a home network)' }
if ($CertsOnly) { exit 0 }

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  Write-Host ''
  Write-Host ' npm was not found. Install Node.js 18 or newer (LTS) from https://nodejs.org and try again.' -ForegroundColor Red
  exit 2
}

Write-Host ''
Write-Host ' npm install (about a minute) ...'
Write-Host ''
"Understudy install $(Get-Date -Format s)  NODE_EXTRA_CA_CERTS=$env:NODE_EXTRA_CA_CERTS" | Out-File $log -Encoding utf8
& $npm.Source install --no-audit --no-fund 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
if ($code -eq 0) {
  Write-Host ''
  Write-Host ' Done. Understudy is starting.' -ForegroundColor Green
  Start-Sleep -Seconds 2
  exit 0
}

$text = Get-Content $log -Raw
Write-Host ''
Write-Host ' Installing failed. What it means:' -ForegroundColor Red
if ($text -match 'SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|CERT_HAS_EXPIRED|certificate') {
  Write-Host '  - A company security client (Netskope, Zscaler ...) replaces HTTPS certificates, and its'
  Write-Host '    certificate is not among the ones found on this PC.'
  Write-Host '  - Ask IT for the root certificate file (.cer, .crt or .pem) of the HTTPS inspection,'
  Write-Host "    copy it into:  $certDir"
  Write-Host '    and open Understudy again. Nothing else needs changing.'
} elseif ($text -match 'ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network') {
  Write-Host '  - npm could not reach the internet. If your company uses a proxy, set it once:'
  Write-Host '      npm config set proxy http://<proxy>:<port>'
  Write-Host '      npm config set https-proxy http://<proxy>:<port>'
  Write-Host '  - The download hosts are registry.npmjs.org and cdn.sheetjs.com. Ask IT to allow them,'
  Write-Host '    or use the offline release ZIP (it already contains node_modules).'
} elseif ($text -match 'E403|E401|blocked|forbidden') {
  Write-Host '  - The company network blocked a download (registry.npmjs.org or cdn.sheetjs.com).'
  Write-Host '    Ask IT to allow both, or use the offline release ZIP (it already contains node_modules).'
} else {
  Write-Host '  - See the messages above.'
}
Write-Host ''
Write-Host " Full log: $log"
Write-Host ''
Read-Host ' Press Enter to close'
exit $code
