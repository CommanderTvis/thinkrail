# Benchmark lessons

- A UI-only prototype omits the engine host's startup and memory cost. When comparing desktop clients, include the same host workload and count every app-owned process.
- A local checkout is not a stable stand-in for `upstream/main`; fetch the remote branch and record its exact commit before building the baseline and prototype host.
- Keep the benchmark summary to one compact table. Pool repeated runs of the same unchanged artifact into one explicitly labeled average; describe the controlled paired comparison separately.
- A request for a React Native client maquette means the UI should read and render real host state over the existing wire. A tiny Hermes host with fixed data does not stand in for that client workload.
- Do not use a warm-host UI relaunch measurement to answer a first-launch startup question. Restart every app-owned process for each sample and start the timer before the first process; label warmed filesystem caches separately from a real post-reboot launch.
- Keep previously measured comparison clients in the report table when adding new rows. Read power and profile conditions from each raw result before describing cross-run comparisons.
- A browser `dom-ready` event and an RN callback after files, chat, and terminal load are different startup milestones. For client comparisons, instrument the same visible workspace state in both and keep richer client-only readiness numbers separate.
- Preserve each client's intended host topology in startup comparisons. The mergeable Electrobun build embeds its optimized host; only RN starts a separate Bun process. Waiting for an external host before launching Electrobun measures a different architecture, even when both processes are cold.
- For native UI fidelity, compare screenshots at the same window dimensions and trace visible text sizes, weights, and colors to the web source. Matching pane widths alone can hide large typography and row-spacing differences.
- React Native Markdown Display renders Markdown soft breaks as newlines by default. Override them to spaces when matching the browser's HTML rendering, while leaving explicit hard breaks intact.
- Never put horizontal margins only in a React Native row's hovered or selected style. Yoga recalculates child positions when those margins toggle, so icons and labels jump. Keep any intended inset in the row's base style and change only paint on hover.
- For this Bun repository's React Native prototype, use Bun for its package lock and scripts. Develop UI against Metro Fast Refresh, and build Release only for benchmark or release verification; running Xcode on every JavaScript edit wastes iteration time.
- A bar that displays the current document is not a tab bar. Keep an ordered set of open resources with independent selection and close behavior, and restore the resource when an existing tab becomes active.
- Chat tabs must key by host session ID, including their unsent drafts. A single generic chat tab silently replaces the prior conversation even when file tabs work correctly.
- A terminal action in the center tab strip should create a terminal in that group. The lower terminal region has its own controls; wiring the center action to that region violates the layout the user sees.
- A React Native overlay does not acquire Escape dismissal by default. Handle the macOS key event on a focusable dialog overlay and focus it on mount; registering an Escape handler alone leaves focus outside its event tree. The macOS View type exposes keyboard props that the generic react-native View type omits. Verify opening then Escape in the actual foreground app.
- A terminal tab must use its host reservation key as identity, with its PTY and output stored per key. One fixed terminal tab ID or one active PTY makes repeated opens select the same terminal.

- On macOS, a model `.ts` file and a component `.tsx` file must have different basenames beyond capitalization. Case-insensitive resolution can select the model for a component import; use names such as `chatActivityModel.ts` and `ChatActivity.tsx`.

- A Hermes RegExp constructor probe does not prove Shiki compatibility. Test named capture results and capture offsets, then all supported grammars in the actual runtime. This Hermes build accepts named-group syntax but does not expose the results required by Shiki’s JavaScript scanner; use a native Oniguruma scanner.
- CocoaPods exclude_files removes matched files even when an included C source needs them. Enumerate compilation units from the upstream Makefile and preserve included Unicode data files without excluding them. Use pod update for changed local podspecs; pod install may retain the cached spec.

- TextMate grammars can contain byte escapes such as CSS `\x00–\x7F`; compiling them in UTF-16 Oniguruma fails despite Unicode-only fixture success. Compile/scan UTF-8 and translate input/capture offsets to UTF-16, then verify all supported grammars through the real RN bridge.

- React Native Markdown Display removes the first paragraph of every list item, including loose lists, and checks any ancestor when choosing list markers. Preserve list-paragraph nodes before its cleanup and use the nearest list for numbering; test the real parser pipeline, including task/alert plugin ordering.

- Native onLayout coordinates are relative to the immediate parent, not the document scroll content. Resolve Markdown anchors with live heading/root refs and measureLayout on click; ignore callbacks after unmount/replacement and keep measured views from being flattened.

- RN macOS single-line text fields emit Escape cancellation through onKeyPress. A picker parent onKeyDown alone can leave the menu open; register Escape on the input and handle its cancellation event, then verify dismissal and opener focus in the Release app.

- When app and host launch concurrently, a long fixed WebSocket retry delay can dominate layout time and produce two sample clusters. Inspect individual samples, use bounded fast startup retries with a normal fallback, and remeasure before attributing the delay to the UI framework.

- Verify the compiled entry point of the actual benchmark binary before calling it host-only. The optimized CLI artifact can retain embedded/staged web assets even when a separate native-host entry exists in source. CPU sample shares also exclude unsampled native startup and must not be presented as wall-time percentages.

- Before rerunning an externally maintained prototype, check its validation notes for the current published bundle. A standard app path may lag behind named review bundles. Isolate persistent profiles per sample so restored projects and layout preferences cannot silently change the workload.
