# ThinkRail desktop startup

## Benchmarks

Apple M4 Pro / macOS 26.6.2, on AC. Ten fresh app + host launches per row after an excluded filesystem warm-up. Memory is `phys_footprint` from `footprint` (Activity Monitor's “Memory”). Values are mean ± sample std dev.

| Client | UI stack | Host / workload | Host ready | First window | Workspace layout | Footprint | Host footprint |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| ThinkRail upstream baseline | [React](https://react.dev/) with [React Compiler](https://react.dev/learn/react-compiler) + [Electrobun](https://framework.blackboard.sh/electrobun/) (WebKit) | Embedded Bun + Pi; full host | — | 405 ± 33 ms | 843 ± 54 ms | 295 ± 36 MiB (median 284) | included in app |
| ThinkRail React Native prototype | [React Native macOS](https://github.com/microsoft/react-native-macos/) + [Hermes](https://hermesengine.dev/), with [React Compiler](https://react.dev/learn/react-compiler) | Separate upstream Bun + Pi; full host, including web assets | 341 ± 37 ms (median 324) | 189 ± 13 ms | 478 ± 10 ms | 162 ± 1 MiB | 113 ± 1 MiB |
| [Sharprail](https://github.com/CommanderTvis/sharprail/tree/upstream) embedded prototype | [Avalonia](https://avaloniaui.net/) + [.NET 10](https://dotnet.microsoft.com/) CoreCLR / ReadyToRun | Embedded C#; files + Git/worktrees in background; default Ghostty terminal (PTY); no Pi | — | 443 ± 16 ms | 421 ± 17 ms; files loaded, Git pending | 413 ± 10 MiB | included in app |
| [Sharprail](https://github.com/CommanderTvis/sharprail/tree/upstream) remote prototype | [Avalonia](https://avaloniaui.net/) + [.NET 10](https://dotnet.microsoft.com/) CoreCLR / ReadyToRun | Separate C# over gRPC; Git/worktrees in background; default Ghostty terminal (PTY owned by the host); no Pi; UI starts after host binds | 153 ± 4 ms | 569 ± 12 ms total; 416 ± 10 ms after host ready | 650 ± 10 ms total; 497 ± 12 ms after host ready; files loaded, Git pending | 485 ± 7 MiB | 76 ± 1 MiB |
| [Zed](https://zed.dev/) | [GPUI](https://gpui.rs/) | Editor's own workload; host not instrumented | — | 233 ± 21 ms | — | 130 ± 8 MiB | — |
| [JetBrains Air](https://www.jetbrains.com/air/) | [Compose Desktop](https://kotlinlang.org/compose-multiplatform/) | Existing profile; host not instrumented | — | 1585 ± 89 ms | — | 1531 ± 25 MiB | — |

Embedded hosts share the app process; separate hosts run alongside it.

Sharprail rows measure `SharpRail.app` built from the [`upstream` branch](https://github.com/CommanderTvis/sharprail/tree/upstream) at `104678a`. Its default layout opens a Ghostty terminal, so every launch spawns a login shell; `/usr/bin/login` is setuid and unreadable to `footprint`, and is the only process excluded from the totals. Layout waits for the project and its root files; Git/worktree refresh follows in the background.

What each column measures. Every time is milliseconds from `t0`, taken in the harness just before the first process of that row is spawned (for Sharprail remote that is the host; for RN the UI and host are spawned together). All clocks are wall-clock epoch time.

- Host ready: the host answers HTTP `/health` (RN) or has bound its gRPC port (Sharprail remote), polled from the harness. It means the host accepts connections, not that Pi is ready. Embedded hosts have no separate timer. Sharprail remote also reports “after host ready”: the same milestone minus the host-ready time of that sample, which includes the handoff that launches the UI.
- First window: an external probe (`window-probe.m`) polls the WindowServer every 10 ms and reports the first time it lists a normal window of at least 300×200 px owned by the app process. It is when the OS knows about a window, not when pixels are painted, and it has up to 10 ms of polling granularity.
- Workspace layout: a marker emitted from inside the app once the workspace structure has been committed after project/workspace restore (RN: the workspace-mounted effect; Sharprail: after mounting the workspace and a forced layout pass; upstream: the `workspace-workbench` element first appearing in the web view's DOM, reported by an injected probe). It is not rendering, data loading beyond what the row states, or interactivity.
- First window and layout are independent measurements, not nested steps, so either can come first. Sharprail's layout marker (in the process) can precede the WindowServer listing the window, which is why its layout time can be lower than its first-window time. RN's window appears long before its layout because it paints a shell immediately and mounts the workspace after connecting to the host.
- Footprint and host footprint are defined below; workspace layout does not include Git status or the terminal unless the row says so (Sharprail: files loaded, Git pending).
- Footprint at five seconds sums `footprint` over the app + host trees and new WebKit processes; host footprint is already included. Unlike RSS it counts compressed/swapped dirty pages and ignores clean file-backed pages. Zed runs with an isolated profile and no project (2 processes).
- Outliers are kept: the upstream baseline had one launch at 398 MiB (others 280–286) and layouts of 948 and 910 ms (others 756–853); RN had one launch with host ready at 441 ms (others 320–351).

The upstream baseline is JetBrains/thinkrail at `3822748ba86a365d776c4db73af341f822d064dc`; RN is built on the same commit and uses its unchanged Bun host. Both UIs are compiled with React Compiler. The RN client opens existing chats but does not create one on a fresh workspace, so the harness creates the live Pi session through the host in every launch; RN's footprint therefore covers a workspace with files and no open chat. Startup retries use 25 ms for one second, then 500 ms after welcome or timeout. RN reaches workspace layout about 1.8× sooner than upstream. Editor/terminal rendering in RN is naive; settings/provider workflows are outside the fixture.

Samples: [upstream desktop](benchmark-results-desktop-workspace-ac.json), [RN + upstream host](benchmark-results-rn-unoptimized-bun-ac.json), [Sharprail embedded](benchmark-results-sharprail-embedded-ac.json), [Sharprail remote](benchmark-results-sharprail-remote-ac.json), [Zed](benchmark-results-zed-footprint.json), [Air](benchmark-results-air-footprint.json). Screenshots: [upstream](screenshots/original-workspace.png), [RN](screenshots/native-workspace.png).

## The React Native prototype

A native macOS client for the existing ThinkRail host, living in `apps/native`. React Native macOS renders the UI with AppKit views and runs its JavaScript on Hermes; the host is the unchanged upstream Bun + Pi process, reached over the same WebSocket protocol as the web client. Only the UI is replaced.

Differences from upstream:

- Upstream embeds the host in its Electrobun app; the prototype launches the host as a separate process and connects to it, so host startup and UI startup overlap.
- Native AppKit views instead of a WebKit web view; no DOM, CSS or web bundle is loaded.
- Projects, workspaces, chats, files, changes/diffs, specs, review, a basic terminal and most settings exist; docking/layout presets, Monaco, xterm, extension UI and updates do not. Editor and terminal rendering are deliberately naive.
- The upstream browser e2e suite is being ported case by case through an in-app automation bridge; status is in [E2E.md](E2E.md).

## Sharprail

[Sharprail](https://github.com/CommanderTvis/sharprail/tree/upstream) is a separate C# port of the ThinkRail workbench that replaces both the UI and the host. Avalonia draws the UI through Skia; Scintilla edits text, Ghostty renders terminals and Merman lays out Mermaid diagrams, all natively. The C# host implements files, project and spec discovery, Git changes/diffs, worktrees, shared state and PTY terminals, either embedded in the app process or as a separate process over gRPC.

Differences from upstream:

- No Pi: there is no agent loop, providers, tools, sessions or extensions, so no chats, and no commit/push. Terminals exist and open by default. Its benchmark workload is lighter than upstream's and the RN prototype's, which both start a Pi host.
- .NET CoreCLR with ReadyToRun and tiered PGO instead of Bun (host) and WebKit (UI); one language for both sides.
- Direct calls when embedded, protobuf over gRPC when remote, instead of upstream's JSON-over-WebSocket protocol.
- Avalonia controls rendered by Skia, identical across platforms, instead of platform web views.

## Language and runtime requirements

The host must load plugins installed after the app was built, without rebuilding it: an open-world runtime is required. A closed-world executable would need an additional interpreter/runtime. Cold startup, RAM and filesystem/socket/subprocess/PTY capabilities matter; UI and host runtimes can differ.

C# + [CoreCLR/ReadyToRun](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) offers precompiled startup code while retaining JIT optimization, reflection, dynamic assembly loading and code generation. Sharprail uses no trimming or NativeAOT; first-use JIT remains possible. Its 413 MiB embedded / 485 MiB remote total (409 MiB remote UI) is well above RN/Hermes; it includes native editor, terminal and diagram engines, and the missing agent workload prevents a full-client ranking. A Hermes host would require native bridges for filesystem, watchers, sockets, subprocesses and PTYs.

A JVM is open-world too; startup/RAM cost motivates alternatives, though Air's 1531 MiB is an application result, not JVM overhead. GraalVM Native Image normally assumes a closed world. [Project Crema](https://github.com/oracle/graal/issues/11327) adds dynamic class loading/execution, with [experimental JIT work](https://www.graalvm.org/uploads/graalvm_project_advisory_board_meeting_april_2026.pdf); CoreCLR already retains these dynamic capabilities.

## UI framework requirements

Good macOS, Windows and Linux clients are required; mobile is a potential next target. Keyboard navigation, text selection, accessibility, clipboard, menus and window behavior matter alongside precise, consistent layout.

[Avalonia supports desktop plus iOS/Android](https://docs.avaloniaui.net/docs/supported-platforms) with one UI framework. RN has a mobile path and [separate desktop implementations](https://reactnative.dev/docs/out-of-tree-platforms); our intended Linux fallback would be React Native Web inside Electron/Electrobun. Avalonia avoids that additional browser UI path.

[Avalonia renders its own controls through Skia](https://docs.avaloniaui.net/docs/fundamentals/cross-platform-architecture), offering consistent appearance across platforms. RN adapts to AppKit, Windows controls and web. [Electrobun defaults to different system WebViews](https://framework.blackboard.sh/electrobun/apis/bundling-cef/)—WKWebView, WebView2, WebKitGTK; Chromium/CEF is optional. Fonts, DPI and decorations still need validation for literal pixel identity. These benchmarks verify macOS only.

## Sharprail host and transport ideas

C# throughout removes Bun and the Pi dependency graph. Replacing Pi in a full client would require its agent loop, providers, tools, sessions and extensions; Sharprail implements none of that.

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
