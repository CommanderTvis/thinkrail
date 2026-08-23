---
id: submodule-server-dialog
type: submodule-design
status: active
title: dialog — native folder and file pickers
parent: module-server
tags: [v1]
---

## Responsibility

The host's native pickers, so a browser that cannot see the filesystem still gets a real OS dialog:
a folder for "Open project", a file for choosing an executable.

## Boundary

- **Owns:** `selectDirectory()` and `selectFile()` — the host's native pickers, per OS and per kind via
  `pickersFor(platform, kind)`: macOS `osascript` (`choose folder` / `choose file`), Linux `zenity` then
  `kdialog` (whichever is installed), Windows a PowerShell `FolderBrowserDialog` / `OpenFileDialog`. The
  two kinds differ only in the dialog they raise; everything below — the fallback chain, the cancel/failure
  reading, the Windows foreground dance — is shared, and each kind has its own override
  (`THINKRAIL_PICK_DIR`, `THINKRAIL_PICK_FILE`, resolved before native availability checks) so one never
  answers for the other in e2e.
  **macOS asks for invisibles when picking a file**, since the thing most worth picking here is a CLI that
  installs itself under `~/.local/bin` or `~/.claude/local`, which `choose file` otherwise hides.
  The pickers return `null` **only** when the user cancels. Picker completion is classified
  from exit code plus diagnostics: AppleScript's `-128` marker and Linux exit 1 without stderr are
  cancellation; Linux exit 1 with diagnostics (including GTK's `Failed to open display`) and every
  PowerShell non-zero exit are failures (PowerShell exits 0 on cancel). Linux with neither `DISPLAY` nor
  `WAYLAND_DISPLAY` fails before
  spawn with an actionable no-graphical-session reason. A missing or failed candidate falls through to the
  next candidate; cancellation stops. If all candidates are missing or fail, the method throws the most
  useful observed reason, because a silent `null` is a dead button.
  **File-indirection:** when an override names an existing *file*, its trimmed contents are
  **re-read per call**. Plain content is the returned path; `error:<message>` throws that deterministic
  failure before native availability checks. One shared source, binary, or desktop e2e host can therefore
  hand different folders, files, or failures to different tests by rewriting the pointer (a directory
  value is returned as-is).
- **Windows: the dialog must come up focused, in front of the browser.** The host is a background
  process, and Windows only lets the process that *owns* the foreground call `SetForegroundWindow` — so a
  plain `ShowDialog()` opens behind the browser, unfocused, reading as "the button does nothing". An
  invisible top-most owner form is **not sufficient on its own**: measured on Windows 11 with an unrelated
  app in front, the dialog came up unfocused in 3/3 runs — visible, but the keyboard still belonged to the
  browser. What works is the documented way past the foreground lock: the script `AttachThreadInput`s to
  the foreground window's thread (sharing its input queue makes our `SetForegroundWindow` legal),
  foregrounds the owner form, detaches, then shows the dialog **owned** by that now-foreground form.
  Measured on Windows 11: focused and on top in 3/3 runs, Enter selects the highlighted folder, Escape
  returns `null` at exit 0. The whole grab is **best-effort** — wrapped so a host that can't compile the
  P/Invoke, or an elevated foreground app that refuses the steal, degrades to the old behaviour (the
  dialog still opens, just behind) instead of failing the pick.
  The script is handed over as `-EncodedCommand` (base64/UTF-16LE), not `-Command`: it is multi-line and
  contains the double quotes of P/Invoke signatures, which Windows argv quoting plus PowerShell's own
  re-parse do not preserve.
- **Public surface (barrel):** `selectDirectory`, `selectFile` (+ `pickersFor` / `Picker` / `PickKind` and
  the two message builders `pickerFailure` / `noPickerMessage`, exposed for unit tests).
- **Allowed deps:** Bun (spawn), `process.env`.
- **Forbidden:** `host`; sibling features; `contracts` (none needed).
