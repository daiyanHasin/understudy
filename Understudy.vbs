' Understudy launcher: starts Understudy with no console window.
' Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved.
' Double-click this file (or the desktop shortcut it offers to create).
Option Explicit
Dim sh, fso, dir, rc, desktop, flag, lnkPath, lnk, answer, q, ps, certs
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
q = Chr(34)
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
ps = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & q & dir & "\tools\install-deps.ps1" & q
certs = dir & "\tools\certs\company-ca.pem"

' 1. Node.js
rc = sh.Run("cmd /c where node >nul 2>&1", 0, True)
If rc <> 0 Then
  MsgBox "Understudy needs Node.js 18 or newer." & vbCrLf & vbCrLf & _
         "Install the LTS version from https://nodejs.org, then open Understudy again.", vbExclamation, "Understudy"
  WScript.Quit 1
End If

' 2. First start: install components (a window shows progress).
'    tools\install-deps.ps1 also handles company networks that inspect HTTPS
'    (Netskope, Zscaler ...): it gives npm the certificates Windows trusts, so
'    "SELF_SIGNED_CERT_IN_CHAIN" no longer stops the install.
If Not fso.FolderExists(dir & "\node_modules\exceljs") Or Not fso.FolderExists(dir & "\node_modules\xlsx") Or Not fso.FolderExists(dir & "\node_modules\yaml") Then
  MsgBox "First start: Understudy will now install its components." & vbCrLf & _
         "This takes about a minute and needs internet.", vbInformation, "Understudy"
  rc = sh.Run(ps, 1, True)
  If rc <> 0 Then
    MsgBox "Installing failed. The install window explained why; the full log is in" & vbCrLf & _
           dir & "\logs\install.log" & vbCrLf & vbCrLf & _
           "On a company network: ask IT for the HTTPS-inspection root certificate (.cer/.pem)," & vbCrLf & _
           "copy it into the tools\certs folder and open Understudy again.", vbCritical, "Understudy"
    WScript.Quit 1
  End If
End If

' 2b. Certificates for Understudy itself ("Install phone tools", AI helper downloads).
'     Made once, without a window, for installs that predate install-deps.ps1.
'     Rebuilt when IT's certificate file is copied into tools\certs later.
If Not fso.FileExists(certs) Or CertsAdded() Then sh.Run ps & " -CertsOnly", 0, True
If fso.FileExists(certs) Then sh.Environment("Process")("NODE_EXTRA_CA_CERTS") = certs

' 3. Offer a desktop shortcut once
If Not fso.FolderExists(dir & "\logs") Then fso.CreateFolder(dir & "\logs")
flag = dir & "\logs\.shortcut-offered"
desktop = sh.SpecialFolders("Desktop")
lnkPath = desktop & "\Understudy.lnk"
If Not fso.FileExists(flag) And Not fso.FileExists(lnkPath) Then
  fso.CreateTextFile(flag, True).Close
  answer = MsgBox("Add an Understudy shortcut to your desktop?", vbYesNo + vbQuestion, "Understudy")
  If answer = vbYes Then
    Set lnk = sh.CreateShortcut(lnkPath)
    lnk.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
    lnk.Arguments = q & WScript.ScriptFullName & q
    lnk.WorkingDirectory = dir
    lnk.IconLocation = dir & "\assets\understudy.ico"
    lnk.Description = "Understudy - record and run mobile tests"
    lnk.Save
  End If
End If

' 4. Start the server hidden. It opens its own app window. If Understudy is
'    already running, the new copy just opens the window and exits.
'    The log is written to logs\understudy.log.
sh.Run "node web-gui.js --hidden", 0, False

Function CertsAdded()
  Dim f, made
  CertsAdded = False
  If Not fso.FileExists(certs) Then Exit Function
  made = fso.GetFile(certs).DateLastModified
  For Each f In fso.GetFolder(dir & "\tools\certs").Files
    If LCase(f.Name) <> "company-ca.pem" And (f.DateCreated > made Or f.DateLastModified > made) Then CertsAdded = True
  Next
End Function
