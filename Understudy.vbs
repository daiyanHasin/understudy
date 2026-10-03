' Understudy launcher: starts Understudy with no console window.
' Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved.
' Double-click this file (or the desktop shortcut it offers to create).
Option Explicit
Dim sh, fso, dir, rc, desktop, flag, lnkPath, lnk, answer, q
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
q = Chr(34)
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' 1. Node.js
rc = sh.Run("cmd /c where node >nul 2>&1", 0, True)
If rc <> 0 Then
  MsgBox "Understudy needs Node.js 18 or newer." & vbCrLf & vbCrLf & _
         "Install the LTS version from https://nodejs.org, then open Understudy again.", vbExclamation, "Understudy"
  WScript.Quit 1
End If

' 2. First start: install components (a small window shows progress)
If Not fso.FolderExists(dir & "\node_modules\exceljs") Or Not fso.FolderExists(dir & "\node_modules\xlsx") Or Not fso.FolderExists(dir & "\node_modules\yaml") Then
  MsgBox "First start: Understudy will now install its components." & vbCrLf & _
         "This takes about a minute and needs internet.", vbInformation, "Understudy"
  rc = sh.Run("cmd /c title Installing Understudy && npm install --no-audit --no-fund", 1, True)
  If rc <> 0 Then
    MsgBox "Installing failed. Check your internet connection and try again.", vbCritical, "Understudy"
    WScript.Quit 1
  End If
End If

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
