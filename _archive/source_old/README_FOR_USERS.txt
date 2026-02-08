========================
Dev Assistant (Portable)
========================

WHAT’S IN THE ZIP
-----------------
- DevAssistant\DevAssistant.exe  → the app
- Start-Assistant.cmd (recommended) / Start-Assistant.ps1
- tools\  → optional portable copies of Git/FFmpeg/etc. (use offline)
- Start-Assistant.log  → launch/install log (created on first run)

QUICK START (MOST USERS)
------------------------
1) Extract the ZIP to a normal folder (do NOT run from inside the ZIP).
2) Double-click **Start-Assistant.cmd**.
3) Choose:
   - [Y]  Install Git & FFmpeg if online (or use portable copies if offline)
   - [A]  Install common dev tools (Git, FFmpeg, Node, Flutter, JDK, Gradle)
   - [N]  Install nothing; just use portable tools if present
4) App launches. Click **Browse Project**, pick your repo folder, then **Deep Scan**.

IF WINDOWS BLOCKS THE SCRIPT
----------------------------
- SmartScreen on EXE: click **More info → Run anyway**.
- PowerShell policy: right-click the folder → **Open PowerShell window here**, then run:
  powershell -ExecutionPolicy Bypass -NoProfile -File .\Start-Assistant.ps1

OFFLINE / NO-INTERNET MODE
--------------------------
Drop standalone binaries into:
- tools\git\cmd\git.exe
- tools\ffmpeg\bin\ffmpeg.exe and ffprobe.exe
(optional)
- tools\nodejs\node.exe
- tools\flutter\bin\flutter.bat
- tools\jdk\bin\java.exe
- tools\gradle\bin\gradle.bat
The launcher automatically prepends these to PATH.

TROUBLESHOOTING QUICKIES
------------------------
- Nothing happens?  Open **Start-Assistant.log** in the same folder and read the last lines.
- Test the PowerShell launcher directly:
  powershell -ExecutionPolicy Bypass -NoProfile -File .\Start-Assistant.ps1
- EXE missing after extraction?  Ensure the folder contains: DevAssistant\DevAssistant.exe
- “git/ffprobe not found”: choose [Y] or [A] on first run (online), or place portable copies in tools\ as above.
- UI looks idle during big scans: watch the status bar; use **Cancel Task** to stop a long scan.

BASIC USE INSIDE THE APP
------------------------
1) **Browse Project** → select your app repo.
2) **Deep Scan** → indexes files (code + configs + docs).
3) Type a request (plain English), e.g.:
   - “add sticker gifts to livestream UI with coin deduction + daily cap”
   - “fix KeyError in analytics and add a unit test”
4) Click **Propose (Pretrained)** → review the diff → **Apply Proposed**.
5) Click **Run Tests (smart)** to execute the detected test tool (Flutter/Jest/Pytest/etc.).

HANDY COMMANDS (Power Users)
----------------------------
# Expand the ZIP manually to a test folder:
Expand-Archive .\DevAssistant_Portable.zip -DestinationPath .\_test -Force

# Run the PS1 directly with policy bypass:
powershell -ExecutionPolicy Bypass -NoProfile -File .\Start-Assistant.ps1

# Check the log:
Get-Content .\Start-Assistant.log -Tail 200

# Launch EXE directly (bypass scripts altogether):
.\DevAssistant\DevAssistant.exe

NOTES
-----
- The app is local/offline by default. If a local GPT4All model (.bin) is present,
  set the G4A_MODEL env var to its path to keep everything fully offline.
- Running tests/analyzers requires the project’s toolchains (e.g., Flutter, Node).
