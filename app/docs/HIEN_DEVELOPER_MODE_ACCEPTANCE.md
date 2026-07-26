# HIEN Developer Mode manual acceptance

Use this checklist only with the active HIEN repository:

`D:\dev\viet-immersion`

Do not open or modify `D:\dev\hien-production`. Record each item as **Manual pass**, **Not tested**, or **Blocked**. Automated test results do not count as manual passes.

## Preparation

1. Record the HIEN branch, HEAD, and `git status --short --branch`.
2. Launch NF:

   ```powershell
   Set-Location 'D:\dev\dev\DevAssistantCursorLite\app'
   npm run tauri dev
   ```

3. Select **Developer**.
4. Select **Open existing repository**, then choose `D:\dev\viet-immersion`.

## Workspace and editor

5. Confirm the canonical path is `D:\dev\viet-immersion`.
6. Confirm repository name, branch, HEAD, and clean/dirty state match Git.
7. Confirm the profile reports Flutter and shows the safely parsed project name.
8. Confirm Flutter and Dart SDK availability and the four suggested validation commands.
9. Open `lib/main.dart` and confirm readable Dart highlighting.
10. Make an unsaved draft without saving.
11. Navigate away and return; confirm the draft remains.
12. Use external `git diff` and confirm the disk file remains unchanged.
13. Select a real code range.
14. Confirm AI context shows its relative path, start line, end line, and selected text.

## Provider and patch review

15. Open **Settings** and confirm provider state and model name.
16. Confirm Developer Mode reports the same shared backend credential availability as Automated Builder and no key value appears.
17. Select mock explicitly and confirm its proposal cannot become an applyable Developer patch.
18. If a deterministic test proposal is used, target a harmless non-runtime temporary Markdown file.
19. Confirm the complete unified diff is visible before application.
20. Select one hunk and reject another; verify their selection indicators.
21. Confirm the approval prompt names the selected hunks.
22. Apply only after explicit approval.
23. Run the approved `git diff` inspection and verify the unselected hunk is absent.
24. Choose **Revert most recent NF patch**, approve it, and verify exact prior content is restored or a newly created file is deleted.
25. Remove any temporary validation path and confirm HIEN matches its recorded initial status.

## Curated commands

26. In **Build & Tests**, confirm the workspace CWD is `D:\dev\viet-immersion`.
27. Run **Get dependencies** only if repository-state changes are acceptable; approve `flutter pub get` explicitly.
28. Approve and run `flutter analyze`.
29. Approve and run `flutter test`.
30. Approve and run `dart format --output=none --set-exit-if-changed lib`.
31. Confirm each result shows command, CWD, purpose, risk, start/completion time, duration, status, exit code, truncation, and bounded output.
32. Cancel a running validation where practical and confirm cancellation plus descendant cleanup.
33. In the separate approved-command interface, run `flutter --version`.
34. Try a prohibited form such as `flutter build`; confirm it is rejected without execution.

## Persistence and dogfooding

35. Close Developer Mode, return, and explicitly select the recent HIEN workspace.
36. Confirm workspace and selected context restore only after that action.
37. Record a metadata-only friction item under **Project Memory**.
38. Add notes, mark it resolved, then remove it after confirmation.
39. Confirm neither `.devassistant` nor a friction-log file appears in HIEN.
40. Exit and reopen NF; explicitly restore the recent workspace and confirm session state.
41. Record final HIEN branch, HEAD, and status and compare them with step 1.

## Automated evidence

The following are automated gates and must be recorded separately from the manual checklist:

- TypeScript type-check
- All frontend `test:*` scripts
- Vite production build
- Rust check and tests
- Real-HIEN read-only backend inspection
- Debug Tauri build
- Packaged startup smoke
- Changed-file secret and unsafe-shell scans
