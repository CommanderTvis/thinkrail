# ThinkRail desktop startup

## Benchmarks

Apple M4 Pro / macOS 26.6.2, on AC. Ten fresh app + host launches per row after an excluded filesystem warm-up. Memory is `phys_footprint` from `footprint` (Activity Monitor's “Memory”). Values are mean ± sample std dev.

| Client | UI stack | Host / workload | Host ready | First window | Footprint | Host footprint |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| ThinkRail upstream baseline | [React](https://react.dev/) with [React Compiler](https://react.dev/learn/react-compiler) + [Electrobun](https://framework.blackboard.sh/electrobun/) (WebKit) | Embedded Bun + Pi; full host | — | 593 ± 44 ms | 467 ± 55 MiB | included in app |
| ThinkRail React Native prototype | [React Native macOS](https://github.com/microsoft/react-native-macos/) + [Hermes](https://hermesengine.dev/), with [React Compiler](https://react.dev/learn/react-compiler) | Separate upstream Bun + Pi; full host, including web assets | 341 ± 37 ms (median 324) | 189 ± 13 ms | 162 ± 1 MiB | 113 ± 1 MiB |
| [Sharprail](https://github.com/CommanderTvis/sharprail/tree/3940aebf3979609b95999a073b84ac32c732d418) fork embedded | [Avalonia](https://avaloniaui.net/) + [.NET 10](https://dotnet.microsoft.com/) CoreCLR / composite ReadyToRun | Embedded C#; current ThinkRail fork port with docking, editor, PTY terminals, Git/review and bundled plugins; fresh profile; no running agent or Pi | — | 384 ± 17 ms | 392 ± 73 MiB | included in app |
| [Zed](https://zed.dev/) | [GPUI](https://gpui.rs/) | Zed 1.24.2; same repository open; isolated profile; own background workload, host not instrumented | — | 212 ± 17 ms | 149 ± 35 MiB | — |
| [JetBrains Air](https://www.jetbrains.com/air/) | [Compose Desktop](https://kotlinlang.org/compose-multiplatform/) | Air 262.834.70; same repository open; isolated profile; no running agent; host not instrumented | — | 1444 ± 76 ms | 833 ± 88 MiB | — |
| [IntelliJ IDEA Community](https://github.com/JetBrains/intellij-community/releases/tag/idea/2026.2.3) | Swing/AWT + JetBrains Runtime 25.0.4; IDEA 2026.2.3 (IC-262.10968.63) | Same repository open with README.md restored; isolated profile, bundled plugins; scanning/indexing may still be active; splash disabled | — | 1015 ± 56 ms | 2086 ± 122 MiB | included in app |

Embedded hosts share the app process; separate hosts run alongside it.

The Sharprail fork row uses a fresh macOS arm64 Release build from [`3940aeb`](https://github.com/CommanderTvis/sharprail/commit/3940aebf3979609b95999a073b84ac32c732d418), copied from `/Users/commandertvis/thinkrail/sharprail`. Its publish settings match the current project script: self-contained .NET 10, SDK 10.0.401, composite ReadyToRun, no trimming or NativeAOT. Each launch uses a fresh isolated profile, opens this repository, and starts no agent. The embedded host and live process-tree descendants are included in footprint.

IntelliJ IDEA Community remains the verified [2026.2.3 open-source release](https://github.com/JetBrains/intellij-community/releases/tag/idea/2026.2.3), build IC-262.10968.63 with JetBrains Runtime 25.0.4. It opens the same repository with README.md restored, using an isolated profile and bundled plugins. The documented [nosplash and dontReopenProjects options](https://www.jetbrains.com/help/idea/working-with-the-ide-features-from-command-line.html) suppress the splash and prevent unrelated projects reopening. Every sample confirms a repository project window at five seconds. Indexing and editor initialization may continue after first window; no workspace-ready marker is instrumented for IntelliJ. Its footprint includes the IDE and bundled Chromium helper process tree.

Refreshed on 2026-10-17: Zed 1.24.2, Air 262.834.70, IntelliJ Community 2026.2.3, the current Sharprail fork, and upstream ThinkRail at [`3bee4f1`](https://github.com/JetBrains/thinkrail/commit/3bee4f16454515674c5548cb96ed46c57c2a4956). Each row has ten fresh-process launches after one excluded warm-up, all on AC, opening this same repository. Zed, Air and IntelliJ use isolated profiles with profile/caches retained after warm-up; Sharprail uses a fresh profile per launch. Air's logs confirm eleven repository openings, including warm-up, with no agent launched. Upstream is a fresh canary build from the updated commit; it retains the same DOM workspace probe and isolated host fixture. Footprint timers target five seconds; accounting excludes zombies, confirmed exited children and other macOS accounts' WebKit processes. All samples are retained. RN keeps its previous build and samples. The five replaced datasets are archived as `*-before-2026-10-17-rerun.json` beside the current files.

Upstream was rerun after machine cleanup on 2026-10-17 using the same commit, binaries and harness: ten measured launches after one excluded warm-up, all on AC. The [pre-cleanup samples](benchmark-results-desktop-workspace-ac-before-cleanup-2026-10-17.json) are preserved.

What each column measures. Every time is milliseconds from `t0`, taken in the harness just before the first process of that row is spawned (for RN the UI and host are spawned together). All clocks are wall-clock epoch time.

- Host ready: the host answers HTTP `/health` (RN), polled from the harness. It means the host accepts connections, not that Pi is ready. Embedded hosts have no separate timer.
- First window: an external probe (`window-probe.m`) polls the WindowServer every 10 ms and reports the first time it lists a normal window of at least 300×200 px owned by the app process. It is when the OS knows about a window, not when pixels are painted, and it has up to 10 ms of polling granularity.
- Footprint at five seconds sums `footprint` over the app + host trees and new WebKit processes; host footprint is already included. Unlike RSS it counts compressed/swapped dirty pages and ignores clean file-backed pages. The refreshed Zed and Air rows open the repository in isolated profiles.
- All ten samples are retained. In the post-cleanup upstream run, first window ranged from 549 to 709 ms. RN retains its earlier host-ready outlier at 441 ms.

The upstream baseline is JetBrains/thinkrail at `3bee4f16454515674c5548cb96ed46c57c2a4956`; RN is built on `3822748ba` and uses that commit's unchanged Bun host. Both UIs are compiled with React Compiler. The RN client opens existing chats but does not create one on a fresh workspace, so the harness creates the live Pi session through the host in every launch; RN's footprint therefore covers a workspace with files and no open chat. Startup retries use 25 ms for one second, then 500 ms after welcome or timeout. The RN row retains its earlier host and samples rather than using the refreshed upstream commit. Editor/terminal rendering in RN is naive; settings/provider workflows are outside the fixture.

Samples: [upstream desktop](benchmark-results-desktop-workspace-ac.json), [RN + upstream host](benchmark-results-rn-unoptimized-bun-ac.json), [Sharprail fork embedded](benchmark-results-sharprail-fork-embedded-ac.json), [Zed](benchmark-results-zed-footprint.json), [Air](benchmark-results-air-footprint.json), [IntelliJ Community](benchmark-results-intellij-community.json). Screenshots: [upstream](screenshots/original-workspace.png), [RN](screenshots/native-workspace.png).

## The React Native prototype

A native macOS client for the existing ThinkRail host, living in `apps/native`. React Native macOS renders the UI with AppKit views and runs its JavaScript on Hermes; the host is the unchanged upstream Bun + Pi process, reached over the same WebSocket protocol as the web client. Only the UI is replaced.

Differences from upstream:

- Upstream embeds the host in its Electrobun app; the prototype launches the host as a separate process and connects to it, so host startup and UI startup overlap.
- Native AppKit views instead of a WebKit web view; no DOM, CSS or web bundle is loaded.
- Projects, workspaces, chats, files, changes/diffs, specs, review, a basic terminal and most settings exist; docking/layout presets, Monaco, xterm, extension UI and updates do not. Editor and terminal rendering are deliberately naive.
- The upstream browser e2e suite is being ported case by case through an in-app automation bridge; status is in [E2E.md](E2E.md).

## Sharprail

[Sharprail](https://github.com/CommanderTvis/sharprail/tree/3940aebf3979609b95999a073b84ac32c732d418) is a separate C# port of the ThinkRail workbench that replaces both the UI and the host. Avalonia draws the UI through Skia; Scintilla edits text, Ghostty renders terminals and Merman lays out Mermaid diagrams, all natively. The C# host implements files, project and spec discovery, Git changes/diffs, worktrees, shared state and PTY terminals, either embedded in the app process or as a separate process over gRPC.

Differences from upstream:

- No Pi: there is no agent loop, providers, tools, sessions or extensions, so no chats, and no commit/push. Terminals exist and open by default. Its benchmark workload is lighter than upstream's and the RN prototype's, which both start a Pi host.
- .NET CoreCLR with ReadyToRun and tiered PGO instead of Bun (host) and WebKit (UI); one language for both sides.
- Direct calls when embedded, protobuf over gRPC when remote, instead of upstream's JSON-over-WebSocket protocol.
- Avalonia controls rendered by Skia, identical across platforms, instead of platform web views.

## Language and runtime requirements

The host must load plugins installed after the app was built, without rebuilding it: an open-world runtime is required. A closed-world executable would need an additional interpreter/runtime. Cold startup, RAM and filesystem/socket/subprocess/PTY capabilities matter; UI and host runtimes can differ.

C# + [CoreCLR/ReadyToRun](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) offers precompiled startup code while retaining JIT optimization, reflection, dynamic assembly loading and code generation. Sharprail uses no trimming or NativeAOT; first-use JIT remains possible. Its 392 MiB embedded total is well above RN/Hermes; it includes native editor, terminal and diagram engines, and the missing agent workload prevents a full-client ranking. A Hermes host would require native bridges for filesystem, watchers, sockets, subprocesses and PTYs.

A JVM is open-world too; startup/RAM cost motivates alternatives, though Air's 833 MiB is an application result, not JVM overhead. GraalVM Native Image normally assumes a closed world. [Project Crema](https://github.com/oracle/graal/issues/11327) adds dynamic class loading/execution, with [experimental JIT work](https://www.graalvm.org/uploads/graalvm_project_advisory_board_meeting_april_2026.pdf); CoreCLR already retains these dynamic capabilities.

## UI framework requirements

Good macOS, Windows and Linux clients are required; mobile is a potential next target. Keyboard navigation, text selection, accessibility, clipboard, menus and window behavior matter alongside precise, consistent layout.

[Avalonia supports desktop plus iOS/Android](https://docs.avaloniaui.net/docs/supported-platforms) with one UI framework. RN has a mobile path and [separate desktop implementations](https://reactnative.dev/docs/out-of-tree-platforms); our intended Linux fallback would be React Native Web inside Electron/Electrobun. Avalonia avoids that additional browser UI path.

[Avalonia renders its own controls through Skia](https://docs.avaloniaui.net/docs/fundamentals/cross-platform-architecture), offering consistent appearance across platforms. RN adapts to AppKit, Windows controls and web. [Electrobun defaults to different system WebViews](https://framework.blackboard.sh/electrobun/apis/bundling-cef/)—WKWebView, WebView2, WebKitGTK; Chromium/CEF is optional. Fonts, DPI and decorations still need validation for literal pixel identity. These benchmarks verify macOS only.

## Sharprail host and transport ideas

C# throughout removes Bun and the Pi dependency graph. Replacing Pi in a full client would require its agent loop, providers, tools, sessions and extensions; Sharprail implements none of that; it integrates external terminal agents rather than an in-process Pi runtime.

One host serves both modes through a transport-independent interface: direct calls when embedded, typed protobuf over [gRPC/HTTP2](https://learn.microsoft.com/en-us/aspnet/core/grpc/) when remote. Wire DTOs stay separate from domain objects. Remote calls support session-token authentication and cancellation; loopback is default, a tailnet endpoint is configurable. Connecting to an existing host is supported, but benchmarks start a fresh local host. Live state and terminal output stream over gRPC, and terminals belong to the host, so a reconnecting client reattaches and replays recent output once. TLS deployment is not implemented.

## Why the upstream host is slow to start

Profiled the unchanged upstream Bun host at `50d5ac934f576d277f12e8bf34c74c78924d19d4` using [Bun’s CPU sampler](https://bun.sh/docs/project/benchmarking): ten fresh host launches on AC after one excluded warm-up, no UI. The ready line arrived in 402 ± 6 ms under profiling; this is not a replacement for the benchmark’s HTTP-health timing. Each of 862 pre-ready samples is assigned once to its nearest bundled module; 18 post-ready samples are excluded.

| Startup work | Share of sampled JS stacks |
| --- | ---: |
| Pi model catalog + provider SDKs | 17.6% |
| Other dependencies | 13.2% |
| ThinkRail host / CLI modules and state | 13.1% |
| TypeBox schemas / validators | 11.7% |
| Logging + date formatting | 11.7% |
| Bun builtins / bundle machinery | 11.6% |
| Pi agent core | 8.4% |
| Pi terminal UI / Markdown / highlighting | 7.9% |
| Synchronous git subprocesses | 4.8% |

These are stack-sample shares, including synchronous native-call/wait frames, not wall-time or all-thread CPU percentages. The first sample arrives ~153 ms after spawn; that earlier interval remains unattributed. Provider imports, schemas, logging and terminal/Markdown dependencies all load even without a UI. Host-module samples include persistence and configuration; synchronous git is another measurable cost. Profiling adds overhead, and the original CLI also includes web assets.

Artifacts: [counts and module attribution](.bench/cpu-original-host/summary.json), [launches](.bench/cpu-original-host/runs.json), [example profile](.bench/cpu-original-host/run-1.cpuprofile), [binary provenance](.bench/cpu-original-host/provenance.json). Reproduce with [capture](.bench/cpu-profile-host.mjs) and [analysis](.bench/cpu-original-host/analyze-js.mjs).
