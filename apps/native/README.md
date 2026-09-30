# ThinkRail React Native macOS client

This prototype uses Microsoft's [React Native for macOS](https://github.com/microsoft/react-native-macos) as a client for the full ThinkRail Bun host. Hermes renders the workbench and holds local navigation state; the Bun host owns projects, workspaces, files, git, terminals, and Pi. The client uses the normal ThinkRail WebSocket. It does not bundle a second Pi worker or serve the web client.

The screen includes project and workspace navigation, chats and streaming messages, model controls, a file tree, rendered Markdown documents with GitHub alert callouts, task checkboxes, scrolling tables, and in-document heading links, changes and diff views, a real PTY with plain-text rendering, tasks, review comments, specs, skills, and status. Settings covers provider sign-in, GitHub status, appearance, line width, chat, layout, terminal, prompt templates, review, privacy, and feedback. It remains a workload and behavior maquette: docking, Monaco, xterm, extension UI, updates, and several advanced settings remain unported.

The default workspace frame follows the desktop app's Projects, workspace, Specs/Files, Changes/Review, and terminal regions. Changes supports host-backed scope and base-branch selection plus list and tree views. Tasks and skills are in the upper group's add menu. AppKit supplies an integrated titlebar, traffic lights, window resizing, and the application menu. The [original workspace](screenshots/original-workspace.png) and [native workspace](screenshots/native-workspace.png) captures use the same benchmark fixture.

The UI and app icons come from the web client's Remix icons, custom file-diff SVG, and ThinkRail logo. Regenerate the committed raster assets with `bun run icons` after installing the root workspace dependencies. The running RN app uses these bundled PNGs, with no icon font or SVG runtime. `bun run themes` refreshes its four palettes from the web client's bundled themes; the macOS build runs this automatically.

The macOS bundle also includes Geist and JetBrains Mono from [Google Fonts](https://github.com/google/fonts/tree/main/ofl) under their included SIL Open Font licenses. The static Geist weights were generated from the variable font, including a dedicated 370-weight face for the web client's ordinary UI text, so the app does not rely on locally installed fonts.

## Build and run

From the repository root, install the root dependencies if needed. Then:

```sh
cd apps/native
bun install --frozen-lockfile
pod install --project-directory=macos
bun run macos
```

`bun run macos` builds a Debug app and starts Metro for Fast Refresh; subsequent JavaScript and UI edits update without another Xcode build. Metro uses an SWC transformer for both development and Release bundles, with the React Compiler (`oxc-transform-react`) applied to `src/` first. Start a full ThinkRail host on loopback port 43423 before opening the app. Set `THINKRAIL_NATIVE_HOST_URL` to use another endpoint; `THINKRAIL_NATIVE_WORKSPACE_ID` can select a workspace initially. The client reconnects if the host restarts. Metro startup is not comparable to a packaged app.

For a benchmarkable Release app, run `bun run build:macos`. Xcode places it under `~/Library/Developer/Xcode/DerivedData/ThinkRailNative-*/Build/Products/Release/ThinkRailNative.app`.

For example, from the repository root, using the unchanged upstream benchmark host already built under `.bench`, start the host in one terminal and the Release app in another:

```sh
THINKRAIL_DATA_DIR=apps/native/.bench/manual-data \
PI_CODING_AGENT_DIR=apps/native/.bench/manual-agent \
PI_OFFLINE=1 THINKRAIL_NO_ANALYTICS=1 \
apps/native/.bench/upstream-main/apps/cli/dist/thinkrail --port 43423 --host 127.0.0.1 --no-open --no-analytics .

native_app=$(find "$HOME/Library/Developer/Xcode/DerivedData" -type d -name ThinkRailNative.app -path '*/Build/Products/Release/*' -print -quit)
"$native_app/Contents/MacOS/ThinkRailNative"
```

## Cold-launch benchmark

Run this from `apps/native` with a Release app and unchanged upstream host binary:

```sh
node compare.mjs \
  --native "$HOME/Library/Developer/Xcode/DerivedData/ThinkRailNative-fhhrrlgrysvjsybuxhuvilumhvad/Build/Products/Release/ThinkRailNative.app" \
  --host .bench/upstream-main/apps/cli/dist/thinkrail \
  --rounds 10
```

The runner starts a fresh RN app and Bun host together on every launch, times from before process creation, checks for a live Pi session, file tree, and git status at five seconds, and counts both process trees in `footprint` (phys_footprint, not RSS). It requires AC power before and after every sample and stops if that changes. Benchmark-only loopback callbacks record when the workspace layout mounts and when the rendered tree later has files, a chat session, and an attached terminal. The UI stamps those events before sending them, so first-use callback networking does not inflate the timings. One launch warms the filesystem cache before the ten measured samples. It saves raw results under ignored `.bench/`. First window is a CoreGraphics signal; RN first content means its React tree mounted before host data arrived.

The [report](BENCHMARK.md) retains the upstream desktop baseline, RN with the unchanged host, Sharprail, and earlier Zed / JetBrains Air results.

Run `bun run typecheck`, `bun run lint`, and `bun test changeTree.test.mjs markdownAlerts.test.mjs markdownHeadingIds.test.mjs markdownPaths.test.mjs markdownTables.test.mjs markdownTasks.test.mjs providerLogin.test.mjs themePalette.test.mjs` from this directory for the client checks.
