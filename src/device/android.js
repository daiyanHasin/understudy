/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Everything Android, in one require: `const android = require("../device/android")`.
 * This file holds no logic; it gathers the device files so callers need not know
 * which file has what. To change something, open the file it comes from:
 *
 *   adb.js           where adb is, run / shell helpers, input checks, devices()
 *   emulator.js      virtual devices, snapshots, stopping devices, heavy processes
 *   wifi-connect.js  pair / connect / USB -> Wi-Fi     (wifi.js explains failures)
 *   screen.js        screen frames (Record tab picture), "did the screen change?"
 *   layout.js        elements on screen (uiautomator), cached per screen change
 *   input.js         tap, swipe, keys, text; screen size, touch device, keyboard
 *   apps.js          installed apps, app in front, launch, open link, install APK
 */
const adb     = require("./adb");
const emu     = require("./emulator");
const connect = require("./wifi-connect");
const screen  = require("./screen");
const layout  = require("./layout");
const input   = require("./input");
const apps    = require("./apps");

module.exports = {
  // adb.js
  WIN: adb.WIN, SERIAL_RE: adb.SERIAL_RE, PKG_RE: adb.PKG_RE,
  sdkRoot: adb.sdkRoot, adb: adb.adb, adbSource: adb.adbSource, isWifi: adb.isWifi, emulator: adb.emulator,
  run: adb.run, shell: adb.shell, shQuote: adb.shQuote, sleep: adb.sleep,
  checkSerial: adb.checkSerial, checkPkg: adb.checkPkg, aaptPath: adb.aaptPath, devices: adb.devices,
  // emulator.js
  avds: emu.avds, startAvd: emu.startAvd, avdProblem: emu.avdProblem, stopDevice: emu.stopDevice,
  snapshot: emu.snapshot, processes: emu.processes, endProcesses: emu.endProcesses,
  // wifi-connect.js
  pair: connect.pair, connect: connect.connect, usbToWifi: connect.usbToWifi,
  normAddr: connect.normAddr, phoneWifiIp: connect.phoneWifiIp,
  // screen.js
  frame: screen.frame, markChange: screen.markChange, screenInfo: screen.screenInfo, stateOf: screen.stateOf,
  // layout.js
  layout: layout.layout, lastLayout: layout.lastLayout, refreshLayout: layout.refreshLayout,
  parseHierarchy: layout.parseHierarchy, prefetch: layout.prefetch, onLayout: layout.onLayout,
  releaseUiAutomation: layout.releaseUiAutomation,
  // input.js
  tap: input.tap, longPress: input.longPress, swipe: input.swipe, key: input.key,
  hideKeyboard: input.hideKeyboard, erase: input.erase, text: input.text, KEYS: input.KEYS,
  screenSize: input.screenSize, touchDevice: input.touchDevice, keyboardArea: input.keyboardArea,
  // apps.js
  packages: apps.packages, apps: apps.apps, foreground: apps.foreground, launch: apps.launch,
  openLink: apps.openLink, apkPackage: apps.apkPackage, install: apps.install
};
