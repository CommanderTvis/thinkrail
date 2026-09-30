# ThinkRail desktop startup

## Benchmarks

Apple M4 Pro / macOS 26.6.2, on AC. Ten fresh app + host launches per row after an excluded filesystem warm-up, rerun 2026-09-29 with memory reported as `phys_footprint` from `footprint` (Activity Monitor's “Memory”) instead of RSS. Values are mean ± sample std dev.

| Client | UI stack | Host / workload | Host ready | First window | Workspace layout | Footprint | Host footprint |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| ThinkRail upstream baseline | [React](https://react.dev/) + [Electrobun](https://framework.blackboard.sh/electrobun/) (WebKit) | Embedded Bun + Pi; full host | — | 404 ± 29 ms | 1165 ± 49 ms | 385 ± 52 MiB (median 371) | included in app |
| ThinkRail React Native prototype | [React Native macOS](https://github.com/microsoft/react-native-macos/) + [Hermes](https://hermesengine.dev/) | Separate upstream Bun + Pi; full host, including web assets | 299 ± 13 ms | 156 ± 15 ms | 348 ± 11 ms | 239 ± 3 MiB | 123 ± 3 MiB |
| Sharprail embedded prototype | [Avalonia](https://avaloniaui.net/) + [.NET 10](https://dotnet.microsoft.com/) CoreCLR / ReadyToRun | Embedded C#; files + Git/worktrees in background; no Pi | — | 425 ± 12 ms | 397 ± 10 ms; files loaded, Git pending | 241 ± 1 MiB | included in app |
| Sharprail remote prototype | [Avalonia](https://avaloniaui.net/) + [.NET 10](https://dotnet.microsoft.com/) CoreCLR / ReadyToRun | Separate C# over gRPC; Git/worktrees in background; no Pi; UI starts after host binds | 137 ± 7 ms | 502 ± 16 ms total; 366 ± 13 ms after host ready | 576 ± 25 ms total; 440 ± 22 ms after host ready; files loaded, Git pending | 373 ± 68 MiB (median ≈ 343) | 79.1 ± 0.1 MiB |
| [Zed](https://zed.dev/) | [GPUI](https://gpui.rs/) | Editor's own workload; host not instrumented | — | 233 ± 21 ms | — | 130 ± 8 MiB | — |
| [JetBrains Air](https://www.jetbrains.com/air/) | [Compose Desktop](https://kotlinlang.org/compose-multiplatform/) | Existing profile; host not instrumented | — | 1585 ± 89 ms | — | 1531 ± 25 MiB | — |

Embedded hosts share the app process; separate hosts run alongside it.

Sharprail (rerun against the `SharpRail.app` artifact built 2026-09-29 00:49) now implements files, Git changes/diffs, worktrees, native selectable Markdown, tab docking and persistent settings; no Pi, chats or PTYs. Its canonical `SharpRail.app` build was rerun in both modes with ten fresh profiles on the same checkout. Layout now waits for project and files; Git/worktree refresh runs afterward in the background. Earlier Avalonia layout measurements waited for Git, so the reduction includes a changed readiness milestone. Markdown/settings interactions are not exercised by this startup fixture. Other client rows retain their previous measurements.

- Total times start before the first process launches. Sharprail remote waits for its host before launching UI; totals include that wait. “After host ready” subtracts readiness per sample, including the handoff to UI launch. RN starts UI and host concurrently. Embedded hosts lack separate timers.
- First window is CoreGraphics window detection, not first pixels. Layout is committed workspace structure, not completed rendering or interactivity; it can precede external window detection. Host ready is HTTP health / gRPC binding, not Pi readiness. A dash means unmeasured.
- Footprint at five seconds sums `footprint` over the app + host trees and new WebKit processes; host footprint is already included. Unlike RSS it counts compressed/swapped dirty pages and ignores clean file-backed pages, so values are not comparable with earlier RSS figures. Zed was rerun with an isolated profile and no project (2 processes), which may differ from the earlier untracked setup, including its first-window time.
- Outliers are kept: Sharprail remote UI footprint was 462 and 368 MiB in two of ten launches (others 258–275); the desktop baseline had 473 and 489 MiB (others 345–375).

The upstream baseline uses commit `50d5ac934f576d277f12e8bf34c74c78924d19d4`. RN uses the unchanged upstream Bun host and confirmed a live Pi session in all ten launches. Startup retries use 25 ms for one second, then 500 ms after welcome or timeout. RN layout is 352 ± 6 ms, about 3.3× faster than upstream’s recorded workspace-layout milestone. Editor/terminal rendering remains naive; settings/provider workflows are outside the fixture. RN shell is 201 ± 18 ms; files + chat + attached terminal is 842 ± 11 ms, a different milestone from layout.

Samples: [upstream desktop](benchmark-results-desktop-workspace-ac.json), [RN + upstream host](benchmark-results-rn-unoptimized-bun-ac.json), [Sharprail embedded](benchmark-results-sharprail-embedded-ac.json), [Sharprail remote](benchmark-results-sharprail-remote-ac.json), [Zed](benchmark-results-2026-09-25-host.json), [Air](benchmark-results-air-footprint.json). [RN before retry fix](benchmark-results-rn-unoptimized-bun-ac-before-reconnect-fix.json). [Original](screenshots/original-workspace.png) / [RN](screenshots/native-workspace.png) screenshots remain available.

## The React Native prototype

A native macOS client for the existing ThinkRail host, living in `apps/native`. React Native macOS renders the UI with AppKit views and runs its JavaScript on Hermes; the host is the unchanged upstream Bun + Pi process, reached over the same WebSocket protocol as the web client. Only the UI is replaced.

Differences from upstream:

- Upstream embeds the host in its Electrobun app; the prototype launches the host as a separate process and connects to it, so host startup and UI startup overlap.
- Native AppKit views instead of a WebKit web view; no DOM, CSS or web bundle is loaded.
- Projects, workspaces, chats, files, changes/diffs, specs, review, a basic terminal and most settings exist; docking/layout presets, Monaco, xterm, extension UI and updates do not. Editor and terminal rendering are deliberately naive.
- The upstream browser e2e suite is being ported case by case through an in-app automation bridge; status is in [E2E.md](E2E.md).

## Sharprail

A separate C# prototype that replaces both the UI and the host. Avalonia draws the UI through Skia, and a C# host implements files, Git changes/diffs, worktrees, Markdown, tab docking and settings, either embedded in the app process or as a separate process over gRPC.

Differences from upstream:

- No Pi: there is no agent loop, providers, tools, sessions or extensions, so no chats and no PTYs. Its benchmark workload is therefore lighter than upstream's and the RN prototype's.
- .NET CoreCLR with ReadyToRun instead of Bun (host) and WebKit (UI); one language for both sides.
- Direct calls when embedded, protobuf over gRPC when remote, instead of upstream's JSON-over-WebSocket protocol.
- Avalonia controls rendered by Skia, identical across platforms, instead of platform web views.

## Language and runtime requirements

The host must load plugins installed after the app was built, without rebuilding it: an open-world runtime is required. A closed-world executable would need an additional interpreter/runtime. Cold startup, RAM and filesystem/socket/subprocess/PTY capabilities matter; UI and host runtimes can differ.

C# + [CoreCLR/ReadyToRun](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) offers precompiled startup code while retaining JIT optimization, reflection, dynamic assembly loading and code generation. Sharprail uses no trimming or NativeAOT; first-use JIT remains possible. Its 241 MiB embedded / 373 MiB remote total (294 MiB remote UI mean, ~265 median) makes .NET promising alongside RN/Hermes, but its smaller workload prevents a full-client ranking. A Hermes host would require native bridges for filesystem, watchers, sockets, subprocesses and PTYs.

A JVM is open-world too; startup/RAM cost motivates alternatives, though Air's 1531 MiB is an application result, not JVM overhead. GraalVM Native Image normally assumes a closed world. [Project Crema](https://github.com/oracle/graal/issues/11327) adds dynamic class loading/execution, with [experimental JIT work](https://www.graalvm.org/uploads/graalvm_project_advisory_board_meeting_april_2026.pdf); CoreCLR already retains these dynamic capabilities.

## UI framework requirements

Good macOS, Windows and Linux clients are required; mobile is a potential next target. Keyboard navigation, text selection, accessibility, clipboard, menus and window behavior matter alongside precise, consistent layout.

[Avalonia supports desktop plus iOS/Android](https://docs.avaloniaui.net/docs/supported-platforms) with one UI framework. RN has a mobile path and [separate desktop implementations](https://reactnative.dev/docs/out-of-tree-platforms); our intended Linux fallback would be React Native Web inside Electron/Electrobun. Avalonia avoids that additional browser UI path.

[Avalonia renders its own controls through Skia](https://docs.avaloniaui.net/docs/fundamentals/cross-platform-architecture), offering consistent appearance across platforms. RN adapts to AppKit, Windows controls and web. [Electrobun defaults to different system WebViews](https://framework.blackboard.sh/electrobun/apis/bundling-cef/)—WKWebView, WebView2, WebKitGTK; Chromium/CEF is optional. Fonts, DPI and decorations still need validation for literal pixel identity. These benchmarks verify macOS only.

## Sharprail host and transport ideas

C# throughout removes Bun and the Pi dependency graph. Replacing Pi in a full client would require its agent loop, providers, tools, sessions and extensions; the maquette implements none of that.

One host serves both modes through a transport-independent interface: direct calls when embedded, typed protobuf over [gRPC/HTTP2](https://learn.microsoft.com/en-us/aspnet/core/grpc/) when remote. Wire DTOs stay separate from domain objects. Remote calls support session-token authentication and cancellation; loopback is default, a tailnet endpoint is configurable. Connecting to an existing host is supported, but benchmarks start a fresh local host. Streaming, reconnection and TLS deployment remain outside the maquette.

## Why the upstream host is slow to start

Profiled the unchanged upstream Bun host from the baseline commit using [Bun’s CPU sampler](https://bun.sh/docs/project/benchmarking): ten fresh host launches on AC after one excluded warm-up, no UI. The ready line arrived in 402 ± 6 ms under profiling; this is not a replacement for the benchmark’s HTTP-health timing. Each of 862 pre-ready samples is assigned once to its nearest bundled module; 18 post-ready samples are excluded.

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
