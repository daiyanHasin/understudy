# Troubleshooting

First look: `logs/understudy.log` (in the Understudy folder). For a live log, start with `start-gui.bat` instead of `Understudy.vbs`.

## Starting and installing
| Problem | Cause | Fix |
|---|---|---|
| Nothing opens after `Understudy.vbs` | Node missing, or a crash at start | Run `start-gui.bat` and read the message; check `logs/understudy.log` |
| `SELF_SIGNED_CERT_IN_CHAIN` on first start | company HTTPS inspection (Netskope, Zscaler) | `tools/install-deps.ps1` normally handles it. If not: ask IT for the inspection root certificate (`.cer/.crt/.pem`), copy it into `tools\certs\`, start again. Never turn TLS checking off. |
| Install fails, no internet | — | Use a release ZIP that includes `node_modules` |
| "Understudy was restarted" banner | server restarted, the window has an old token | Press **Reload** |
| `understudy.localhost` doesn't open | browser policy | Use http://localhost:4545 |

## Phone connection
| Problem | Cause | Fix |
|---|---|---|
| USB phone not listed | USB debugging off, cable is charge-only, or "Allow" not tapped | Turn on USB debugging, use a data cable, unlock the phone and tap **Allow** |
| Listed as *unauthorized* | the PC's key not accepted | Unlock the phone, tap **Allow** (tick *Always allow*) |
| Wi-Fi won't connect | port changed, pairing port used to connect, or office Wi-Fi isolates devices | **Check connection** explains it. Copy *IP address & Port* again; use the connect port, not the pairing port; or use USB / this PC's mobile hotspot |
| QR scanned, nothing happens | the network blocks device discovery | **Pair with a 6-digit code** |
| Phone drops while recording on Wi-Fi | Wi-Fi power saving / phone sleeps | Keep the screen on (Developer options › *Stay awake*), or use USB |

## The screen on the Record tab
| Problem | Cause | Fix |
|---|---|---|
| Few frames per second | Each frame is a full screenshot; the phone's screenshot speed is the limit | Close Understudy and run `npm run frame-speed`: it shows raw vs compressed time and the upper limit for that phone. USB beats Wi-Fi. Lowering the phone's screen resolution helps most. 2–5 fps is normal for screenshots. |
| First frames slower than later ones | the first 4 frames try raw and compressed to pick the faster | Normal; the choice is written to the log ("Screen frames on ... using raw") |
| Black or no picture | phone locked, or a secure screen (banking apps, password fields block screenshots) | Unlock; secure screens can't be shown by any tool |
| "Could not read the screen layout" / "never stops moving" | animation, video or spinner on screen | Tick **Turn off phone animations**, wait for spinners, try again; the step falls back to the screen position |
| "Killed" / "Close Maestro Studio" | another tool holds the phone's UI automation | Close Maestro Studio/Desktop or Appium on that phone, try again |

## Running flows
| Problem | Cause | Fix |
|---|---|---|
| Values empty when a flow runs | data scripts not prepared, wrong path or column name | Press **Prepare Data**; check the `runScript` path and the column name (case-sensitive) |
| "row N does not exist" | fewer data rows than selected | Check the sheet; empty rows are not counted |
| Run seems stuck | Maestro waiting for an element | It times out on its own; **Stop** ends it at once |
| Runs on the wrong phone | several devices connected | Pick the device on the Record tab before running |
| "Close it in Excel" | the workbook is open in Excel | Close it there and save again |
| Phone animations stay off | Understudy was not quit with **Quit** | Start Understudy with the phone connected (restores them), or Developer options › the three *animation scale* settings |

## For developers
| Problem | Fix |
|---|---|
| Something broke after moving or renaming a file | `npm run check` names the file and the missing `require` or route |
| Window shows an error but the server log is quiet | Open the browser console (F12) in the app window |
| Which file handles X? | `docs/FILE-MAP.md` |

Still stuck? Open a GitHub issue with the bug template and attach `logs/understudy.log`.
