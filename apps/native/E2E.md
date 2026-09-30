# Upstream E2E translation

Authoritative source: the browser suite in [`e2e/`](../../e2e) (`e2e/SPEC.md`), at the commit this
branch is based on.

Tests drive the app through an in-process automation bridge (`automation.ts`). When the app is
launched with `THINKRAIL_NATIVE_AUTOMATION_URL`, it starts without activating or showing its window,
connects to the runner over WebSocket, resolves `testID` selectors against the committed React tree,
and invokes the matched element's handlers (`onPress`, `onChangeText`, `onSubmitEditing`,
`onKeyDown`, hover). Each case gets the same isolated Bun host, fixture repository, PI agent
directory and stub executables as the browser suite; upstream global setup, state reset, host
environment and session disposal are imported rather than copied. Playwright Test stays the runner,
so ported cases keep upstream titles and structure; a `NativeApp` fixture replaces `page`.

Text entry (`fill`, `pressSequentially`) goes through AppKit: the bridge focuses the input and a
debug-only native module inserts text into the focused `NSTextView`, so native change events,
selection and event counts behave as with real typing. Clicks, hover and keys invoke React handlers
directly and do not exercise AppKit hit-testing, focus rings or the accessibility tree.

Mapping rules:

- `data-testid` becomes the RN `testID`. The app sets it through `tid(id, attrs)`, which encodes
  upstream `data-*` attributes after the id (`workspace-item|kind=default|active=true`); tests assert
  them with `toHaveAttr`.
- Visibility means the element is in the committed tree. Text is the concatenated text of the
  element's subtree.
- `page.goto("/")` becomes a relaunch of the app against the isolated host. Each relaunch deletes
  the app's host-scoped `NSUserDefaults` keys, standing in for a fresh browser context.
- Browser-only mechanics (URLs, page counts, `sessionStorage`, CSS pseudo-elements, computed style,
  viewport emulation, web workers) have no native counterpart; such cases are ported to their
  observable behavior or stay Pending with the reason.
- Upstream `*.live.spec.ts` suites (26, provider-backed) are out of scope until the deterministic
  suite is green.

The host binds `127.0.0.1` for this suite. The client accepts only `http://127.0.0.1:` host URLs,
while the upstream CLI binds `localhost`, which resolves to `::1` on macOS; the client cannot reach
such a host. That is a known client gap, not worked around in the product.

Run from `apps/native`. The native suite shares the browser suite's per-worktree state directory
and port block, so do not run both at once in one worktree:

```sh
bun run build:macos
bun run e2e
```

For iteration, build Debug once (`npx react-native build-macos --mode Debug`), keep `bun run start`
(Metro) running, and point the suite at it with `THINKRAIL_NATIVE_E2E_APP=<path to Debug
ThinkRailNative.app>`; JavaScript edits then need no Xcode rebuild.

## Known native defects

- `selectTextOnFocus` on a single-line `TextInput` aborts the app when the field gains focus
  (`-[RCTUITextField selectAll:]` is not implemented). The workspace rename field now selects its
  text explicitly after focusing instead.
- react-native-macos 0.81.9's `secureTextEntry` is unusable: `RCTUISecureTextField` subclasses
  `NSTextField`, and AppKit aborts with "the secure field editor's delegate must be an
  NSSecureTextField" when it gains focus. Secret prompts use the app's own `ThinkRailSecureTextField`
  view (a real `NSSecureTextField`, `macos/ThinkRailNative-macOS/SecureTextField.mm`) instead.

## Case inventory

Ported cases retain upstream titles. `Ported` means the translated case passed against the Release
app at the time of the last status update; `Failing` names the client gap.

| Suite | Upstream case | Status |
| --- | --- | --- |
| `00-jbcentral-lifecycle.spec.ts` | Central is not installed: the card asks for the host install, and Recheck picks it up | Pending |
| `00-jbcentral-lifecycle.spec.ts` | Central is installed but signed out: the card offers Sign in, never Connect | Pending |
| `00-jbcentral-lifecycle.spec.ts` | a configured stopped proxy offers Start proxy and returns to Connected | Pending |
| `00-jbcentral-lifecycle.spec.ts` | a sign-in launch that dies falls back to the command to run on the host | Pending |
| `00-jbcentral-lifecycle.spec.ts` | a Connect failure that reveals a signed-out host still offers sign-in exactly once | Pending |
| `00-jbcentral-lifecycle.spec.ts` | Central is uninstalled while connected: models are withdrawn, the artifact survives, reinstall repairs | Pending |
| `00-jbcentral-lifecycle.spec.ts` | PI is disconnected: in-app Disconnect and `central remove pi` on the host both land on ready | Pending |
| `00-jbcentral-lifecycle.spec.ts` | the user logs out of Central while connected: the card keeps the connection and warns | Pending |
| `00-jbcentral-quota.spec.ts` | top-bar quota follows healthy Central and exposes only recurring values | Pending |
| `00-jbcentral-quota.spec.ts` | provider settings control quota polling and validate the shared interval | Pending |
| `00-jbcentral-quota.spec.ts` | stale quota keeps its value, retries immediately, and preserves both numbers on mobile | Pending |
| `00-jbcentral-quota.spec.ts` | quota polling pauses while the page is hidden and refreshes when visible again | Pending |
| `00-jbcentral.spec.ts` | connects and follows external add, replacement, and remove without a host restart | Pending |
| `00-jbcentral.spec.ts` | guides absent, outdated, malformed, and failed Central version states | Pending |
| `00-jbcentral.spec.ts` | a Connect failure with credentials intact offers sign-in without exposing child output | Pending |
| `00-jbcentral.spec.ts` | surfaces missing-artifact and candidate failures as closed UI states, then repairs | Pending |
| `00-jbcentral.spec.ts` | a refused removal and a removal that leaves the artifact are both closed failures | Pending |
| `00-jbcentral.spec.ts` | a failed Update leaves the outdated guidance in place instead of a false recovery | Pending |
| `00-jbcentral.spec.ts` | disconnect removes Central from new chats while an existing live chat keeps its model | Pending |
| `activity-breadcrumbs.spec.ts` | a model-authored Thinking heading stays bounded and appears only while folded | Pending |
| `activity-breadcrumbs.spec.ts` | oldest-first disclosure expansion preserves following and detached reading anchors | Pending |
| `activity-breadcrumbs.spec.ts` | newest-first disclosure expansion preserves following and detached reading anchors | Pending |
| `activity-breadcrumbs.spec.ts` | sticky activity breadcrumbs expose the off-screen Activity → Thinking → tool path | Pending |
| `agent-harness.spec.ts` | agent model parsing preserves provider-qualified ids and rejects malformed targets | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | exact model matching never accepts the first model from another provider | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | Central agent staging copies only the restricted artifact and settings | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | credential denylist covers every environment name in pi-ai's pinned discovery source | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | ambient credential removal is case-insensitive | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | Central Playwright execution requires the public runner authorization and skip-build | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | agent run plan ignores ambient skip, trusts only internal build readiness, and sanitizes Playwright | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | focused full-run planning skips empty phases and rejects an empty selection | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | nested managed runner preserves cleanup and kills every descendant after SIGINT | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | nested managed runner preserves cleanup and kills every descendant after SIGTERM | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | read-only Central fake permits inspection and rejects mutations | Not applicable: tests the Playwright harness itself, not the client |
| `agent-harness.spec.ts` | managed E2E roots preserve hidden Windows consoles and POSIX process groups | Not applicable: tests the Playwright harness itself, not the client |
| `analytics-consent.spec.ts` | first dialog primes on from saved on and Done confirms on | Ported; the switch role becomes the `analytics-toggle` test id |
| `analytics-consent.spec.ts` | first dialog primes on from saved off and Done confirms on | Ported; the switch role becomes the `analytics-toggle` test id |
| `analytics-consent.spec.ts` | first-dialog close accepts the primed on choice | Ported |
| `analytics-consent.spec.ts` | first-dialog escape accepts the primed on choice | Ported |
| `analytics-consent.spec.ts` | first-dialog backdrop accepts the primed on choice | Ported |
| `analytics-consent.spec.ts` | switching off immediately persists refusal and closes from the broadcast | Ported |
| `analytics-consent.spec.ts` | failed done persistence keeps the on choice visible and retryable | Ported |
| `analytics-consent.spec.ts` | failed close persistence keeps the on choice visible and retryable | Ported |
| `analytics-consent.spec.ts` | failed immediate refusal stays off and Done retries it | Ported |
| `analytics-consent.spec.ts` | failed priming remains visible and Done can persist the on choice | Ported |
| `analytics-consent.spec.ts` | confirmation closes a peer draft and later Settings changes converge across clients | Ported with a second app instance; the observer launches before its wire tap, so only its confirmation writes are asserted |
| `analytics-consent.spec.ts` | confirmed on never opens or primes | Ported |
| `analytics-consent.spec.ts` | confirmed off never opens or primes | Ported |
| `analytics-consent.spec.ts` | consent takes precedence over an addressed interview invitation | Ported |
| `analytics-consent.spec.ts` | pre-v65 hosts keep the legacy Privacy switch without a consent dialog or confirmation writes | Not ported: the native client accepts only protocol 70 and refuses older hosts at `server.welcome`; supporting pre-v65 hosts is a product decision |
| `ask-user-question.spec.ts` | a persisted tall questionnaire reveals page changes and a restored page without hidden review focus | Pending |
| `ask-user-question.spec.ts` | a questionnaire with more than four questions exposes every page and the full review | Pending |
| `ask-user-question.spec.ts` | a coarse pointer reveals a returning page's text target without focusing it | Pending |
| `bottom-panel.spec.ts` | full-height panel-header actions stay square | Pending |
| `bottom-panel.spec.ts` | a new workspace starts with one accessible terminal group in a 30% bottom panel | Pending |
| `bottom-panel.spec.ts` | a hidden local frame keeps the host terminal reserved without attaching until shown | Pending |
| `bottom-panel.spec.ts` | a completed initial-terminal handshake never recreates a terminal after explicit close | Pending |
| `bottom-panel.spec.ts` | Mod+Shift+J works from xterm, preserves its PTY through hide and reload, and is modal-aware | Pending |
| `bottom-panel.spec.ts` | bottom height, all alignments, and keyboard resizing persist across reload | Pending |
| `bottom-panel.spec.ts` | bottom alignments give excluded lower corners to the actual side panels | Pending |
| `bottom-panel.spec.ts` | bottom alignments follow locally compressed side geometry at narrow widths | Pending |
| `bottom-panel.spec.ts` | narrow side resizing persists only the side whose separator moved | Pending |
| `bottom-panel.spec.ts` | closing a final bottom resource retains its frame groups until explicit removal | Pending |
| `bottom-panel.spec.ts` | bottom alignments follow side geometry while a resize gesture is in progress | Pending |
| `bottom-panel.spec.ts` | bottom groups arrange left-to-right, resize, fold to 27px, restore, and enforce their own limit | Pending |
| `bottom-panel.spec.ts` | a narrow viewport locally compresses bottom groups without rewriting their topology | Pending |
| `bottom-panel.spec.ts` | bottom visibility and alignment stay local to each window and survive its reload | Pending |
| `bottom-panel.spec.ts` | an old host layout stays inert while a pristine surface starts Balanced | Pending |
| `changes.spec.ts` | Changes tab shows the active worktree's diff and swaps per workspace | Pending |
| `changes.spec.ts` | Rendered markdown diff of a large repetitive file never blocks the main thread | Pending |
| `changes.spec.ts` | Rendered markdown diff shows an error placeholder when the merge worker fails | Pending |
| `changes.spec.ts` | Rendered markdown diff follows live edits on disk (stale merge cancelled, fresh one lands) | Pending |
| `changes.spec.ts` | Changes has a List&#124;Tree toggle; Tree groups files into folders with +/- counts | Pending |
| `changes.spec.ts` | Changes scope selector filters by commit / uncommitted; each scope is its own diff tab | Pending |
| `changes.spec.ts` | Uncommitted scope converges when HEAD moves out-of-band (a commit in a terminal) | Pending |
| `changes.spec.ts` | The scope menu's target-branch picker re-points what the changes are measured against | Pending |
| `changes.spec.ts` | A target that advanced past the fork point adds no phantom changes (merge-base semantics) | Pending |
| `changes.spec.ts` | A change row's action menu opens from the ⌄ button and from right-click; Copy path writes the relative path | Pending |
| `changes.spec.ts` | The diff viewer collapses unchanged context and has a per-tab hide-whitespace + copy header | Pending |
| `changes.spec.ts` | Change rows stay one aligned, fully-highlighted row — menu slot included, long names truncated | Pending |
| `changes.spec.ts` | The diff header keeps its controls on a narrow pane, however long the file's path | Pending |
| `changes.spec.ts` | A commit scope keeps the header readable: short sha on the pill, subject in its tooltip | Pending |
| `changes.spec.ts` | The scope menu is per workspace: its commit rows never carry over to another worktree | Pending |
| `changes.spec.ts` | Re-pointing the target branch re-reads an open branch-scope diff tab — active or backgrounded | Pending |
| `changes.spec.ts` | A commit scope whose commit is rewritten away falls back to All changes with a toast | Pending |
| `changes.spec.ts` | A failed read says so — it never renders as an empty (clean) change set | Pending |
| `changes.spec.ts` | Closing a diff tab disposes Monaco cleanly — no 'TextModel got disposed' assertion | Pending |
| `chat-history.spec.ts` | a disk chat with unfinished work auto-opens; a finished one stays in local history | Ported |
| `chat-history.spec.ts` | the native name command renames a chat durably without sending an agent turn | Ported; reload is a relaunch that restores the persisted active workspace |
| `chat-history.spec.ts` | open and closed chat rename controls edit their labels inline | Ported; focus-return assertions dropped |
| `chat-history.spec.ts` | long chat history remains named and scrollable | Ported as membership of the scrolling list; DOM scroll metrics are browser-only |
| `chat-history.spec.ts` | coarse wheel input crosses realistic virtual geometry before a giant history row mounts | Not ported: measures browser wheel deltas against DOM scroll geometry of a virtualized transcript; the bridge has no wheel input |
| `chat-history.spec.ts` | a closed chat can be moved to trash from history | Failing: needs history search (Ctrl+R), not yet in the app |
| `chat-history.spec.ts` | trashing a chat converges to a second client | Ported with a second app instance |
| `chat-history.spec.ts` | a client that misses chat deletion while offline reconciles it after reconnect | Ported; offline is the observer's wire proxy dropping and holding its connection |
| `chat-history.spec.ts` | with no TODOs, the single newest disk chat opens as a fallback; older ones stay in history | Ported |
| `chat-order.spec.ts` | browser-local chat preferences persist without changing another browser | Pending |
| `chat-order.spec.ts` | newest-first scrolls down into history and returns upward to the latest group | Pending |
| `chat-order.spec.ts` | in newest-first order, auto-collapse and the final-answer copy action still track chronological order | Pending |
| `chat-plan.spec.ts` | the chat plan opens as a popup from the header strip and takes a user item | Pending |
| `chat-plan.spec.ts` | the plan opens as a live plan page tab (markdown is its export) | Pending |
| `chat-plan.spec.ts` | uncommitted work no step claims shows on the plan page as Outside the plan | Pending |
| `chat-scroll.spec.ts` | oldest-first ignores repeated outward wheel input at the physical latest edge | Pending |
| `chat-scroll.spec.ts` | oldest-first does not strand following after a no-op native gesture | Pending |
| `chat-scroll.spec.ts` | oldest-first pauses an active return while a scrollbar pointer is held | Pending |
| `chat-scroll.spec.ts` | oldest-first rearms only when a latest-directed wheel reaches the physical edge | Pending |
| `chat-scroll.spec.ts` | oldest-first detaches when native latest input interrupts an idle return | Pending |
| `chat-scroll.spec.ts` | oldest-first retains pointer intent through post-release scrollbar scrolling | Pending |
| `chat-scroll.spec.ts` | oldest-first recognizes keyboard and focus-induced transcript scrolling | Pending |
| `chat-scroll.spec.ts` | oldest-first keeps control activation neutral during automatic geometry | Pending |
| `chat-scroll.spec.ts` | oldest-first keeps touch intent through canceled-pointer momentum | Pending |
| `chat-scroll.spec.ts` | oldest-first keeps an idle status slot at the logical latest edge | Pending |
| `chat-scroll.spec.ts` | newest-first ignores repeated outward wheel input at the physical latest edge | Pending |
| `chat-scroll.spec.ts` | newest-first does not strand following after a no-op native gesture | Pending |
| `chat-scroll.spec.ts` | newest-first pauses an active return while a scrollbar pointer is held | Pending |
| `chat-scroll.spec.ts` | newest-first rearms only when a latest-directed wheel reaches the physical edge | Pending |
| `chat-scroll.spec.ts` | newest-first detaches when native latest input interrupts an idle return | Pending |
| `chat-scroll.spec.ts` | newest-first retains pointer intent through post-release scrollbar scrolling | Pending |
| `chat-scroll.spec.ts` | newest-first recognizes keyboard and focus-induced transcript scrolling | Pending |
| `chat-scroll.spec.ts` | newest-first keeps control activation neutral during automatic geometry | Pending |
| `chat-scroll.spec.ts` | newest-first keeps touch intent through canceled-pointer momentum | Pending |
| `chat-scroll.spec.ts` | newest-first keeps an idle status slot at the logical latest edge | Pending |
| `compact-command.spec.ts` | /compact is discoverable and routes instructions without creating a user turn | Pending |
| `compaction.spec.ts` | a compacted transcript marks where the summarized messages were | Pending |
| `composer-adaptive.spec.ts` | idle composer keeps one message line above a stable controls row | Pending |
| `composer-adaptive.spec.ts` | panel width changes expand and collapse the same textarea | Pending |
| `composer-adaptive.spec.ts` | half-chat growth caps the editor shell and scrolls the textarea | Pending |
| `composer-adaptive.spec.ts` | chat growth setting persists and compact means six visual lines | Pending |
| `composer-adaptive.spec.ts` | compact phone controls remain inside the chat viewport | Pending |
| `composer-images.spec.ts` | pasting an oversized image downscales it to the 1568px long edge before it can be sent | Pending |
| `composer-images.spec.ts` | pasting a small image leaves its dimensions untouched | Pending |
| `composer-images.spec.ts` | pasting a within-bounds BMP re-encodes it to a provider-accepted type | Pending |
| `composer-images.spec.ts` | an undecodable provider-unsupported file is refused with an error chip, never attached raw | Pending |
| `composer-images.spec.ts` | /compact preserves attached images and its draft until the images are removed | Pending |
| `composer-ime.spec.ts` | composer yields IME Enter events before applying send shortcuts | Pending |
| `custom-icons.spec.ts` | Changes tool uses the custom file-diff glyph; Review uses the discuss glyph | Pending |
| `default-workspace.spec.ts` | the Welcome fork's “Work in project folder” enters the Default workspace — the project folder itself | Ported; terminal I/O goes through the terminal pane's input field, not an xterm textarea |
| `default-workspace.spec.ts` | a terminal branch switch converges every Default branch label live | Ported |
| `default-workspace.spec.ts` | the Default workspace is non-removable and unique; project home stays reachable | Ported |
| `editor.spec.ts` | opens a file in a center Monaco tab, focuses on re-open, and closes | Pending |
| `editor.spec.ts` | hides YAML frontmatter in the rendered view but shows it in source | Pending |
| `editor.spec.ts` | opens a non-markdown file straight to Monaco with no rendered-view toggle | Pending |
| `error-boundary.spec.ts` | a failed editor chunk shows the boundary's reload fallback and keeps the shell alive | Pending |
| `feedback.spec.ts` | feedback settings and the addressed interview prompt preserve the approved lifecycle | Ported; opened links are recorded by the bridge instead of launching a browser; link target/rel, CSS colour, initial focus and middle-click are browser-only |
| `files.spec.ts` | shows files and compacts single-directory runs in the Files tree | Pending |
| `fonts.spec.ts` | loads no fonts from a CDN | Pending |
| `fonts.spec.ts` | serves the self-hosted variable faces, including the brand weight and real italics | Pending |
| `history-jump.spec.ts` | selecting a same-workspace message hit opens the chat and flashes the matched row | Pending |
| `history-jump.spec.ts` | oldest-first offscreen jump in a newly mounted tall chat survives StrictMode materialization | Pending |
| `history-jump.spec.ts` | newest-first offscreen jump in a newly mounted tall chat survives StrictMode materialization | Pending |
| `history-jump.spec.ts` | selecting a cross-workspace message hit switches the active workspace and flashes the row | Pending |
| `history-jump.spec.ts` | an unmapped message hit is a no-op — the overlay stays open and the active workspace is untouched | Pending |
| `history-jump.spec.ts` | searching a prompt's own words that an assistant reply also echoes shows only an assistant crumb in MESSAGES, and the prompt row gets a jump icon | Pending |
| `history-jump.spec.ts` | Shift+Enter on the selected prompt row jumps to the chat and flashes the matching USER turn | Pending |
| `history-jump.spec.ts` | an unmapped prompt hit shows no jump icon, and Shift+Enter on it is a no-op | Pending |
| `history-navigation.spec.ts` | Back and Forward step through chat switches and scope moves | Pending |
| `history-navigation.spec.ts` | Back returns to a deep-linked chat entry | Pending |
| `history-navigation.spec.ts` | Back reopens a just-closed local chat without a current-layout wire write | Pending |
| `history-navigation.spec.ts` | a closed chat's entry survives Back; a deleted chat's entry falls back | Pending |
| `history-search.spec.ts` | Ctrl+R opens history recall, cycles scope to all, zooms to messages, inserts a prompt, and Esc preserves the draft | Pending |
| `history-search.spec.ts` | Cmd/Ctrl+Enter from the overlay sends pending image attachments with the recalled prompt and clears them | Pending |
| `history-search.spec.ts` | empty query in chat scope shows the empty state for a session with no history yet | Pending |
| `history-search.spec.ts` | Ctrl+R dismisses an open mention menu instead of overlapping it | Pending |
| `history-search.spec.ts` | plain ArrowUp/ArrowDown recall steps through this chat's own prior prompts, a diverging edit exits the session, and the history button opens the overlay | Pending |
| `history-search.spec.ts` | a recall step immediately followed by a full-value replace never doubles the value, even under CPU contention | Pending |
| `history-search.spec.ts` | a prompt repeated earlier in the chat recalls at its most recent position, deduped to one entry | Pending |
| `history-search.spec.ts` | the history overlay stays inside the viewport and its query stays focusable at a narrow (~390px) width | Pending |
| `history-search.spec.ts` | ArrowDown repeatedly scrolls the keyboard-selected row into view inside the results container | Pending |
| `history-search.spec.ts` | the zoomed stage's preview pane shows the selected item's full text, including a tail truncated in its row, and updates on ArrowDown; the compact stage has no preview at all | Pending |
| `history-search.spec.ts` | at a narrow (~390px) viewport, the zoomed stage's preview pane stacks below the results list, both visible | Pending |
| `history-search.spec.ts` | the scope badge opens a picker that selects a scope directly without disturbing the results selection, returns focus to the query input, and Ctrl+R still cycles afterward | Pending |
| `history-search.spec.ts` | Ctrl+R and Escape are owned app-wide: both work with focus outside the composer | Pending |
| `history-search.spec.ts` | Ctrl+R inside a terminal belongs to the shell, not to history search | Pending |
| `history-search.spec.ts` | Ctrl+R from an active file tab switches to the chat and opens history search | Pending |
| `history-search.spec.ts` | the Ctrl+R and Ctrl+S chords fire on a non-Latin keyboard layout | Pending |
| `host.spec.ts` | host HTTP surface › /health returns ok | Not applicable: tests the host's HTTP surface, not the client |
| `host.spec.ts` | host HTTP surface › serves the built SPA at the root | Not applicable: tests the host's static web serving, not the client |
| `host.spec.ts` | host HTTP surface › falls back to index.html for an unknown client-side route | Not applicable: tests the host's static web serving, not the client |
| `hydrate-failure.spec.ts` | a transcript that fails to load says so and stays in history | Pending |
| `hydrate-failure.spec.ts` | a failed never-empty fallback keeps its chat reachable too | Pending |
| `layout.spec.ts` | workbench strips and feature toolbars keep one-row geometry with ARIA tabs | Pending |
| `layout.spec.ts` | overflow uses directional fades without changing tab-strip geometry | Pending |
| `layout.spec.ts` | auxiliary panel scrollbars stay quiet at rest and expose only clipped edges | Pending |
| `layout.spec.ts` | ARIA tabs use roving keyboard focus, recover after close, and expose keyboard separators | Pending |
| `layout.spec.ts` | outer side widths publish on pointer-up and restore after reload | Pending |
| `layout.spec.ts` | one local frame survives workspace switches while resource tabs stay workspace-specific | Pending |
| `layout.spec.ts` | a duplicated tab remints copied surface storage and preserves both layouts on reload | Pending |
| `layout.spec.ts` | dragging outer separators hides both sides and preserves their restore state | Pending |
| `layout.spec.ts` | the side group menu shows tools for its own side and opens terminals in that group | Pending |
| `layout.spec.ts` | a terminal can move to its own side group; resize, fold, and visibility gate its one body | Pending |
| `layout.spec.ts` | side groups expose broad per-panel above and below split targets | Pending |
| `layout.spec.ts` | Mod+B and Mod+J hide and restore local sides without affecting bottom | Pending |
| `layout.spec.ts` | keyboard and menu commands reorder, search, recursively split, and explicitly remove empty groups | Pending |
| `layout.spec.ts` | each center group owns an independent preview slot | Pending |
| `layout.spec.ts` | deferred opens stay with their request-time group and reroute only when it disappears | Pending |
| `layout.spec.ts` | pointer drag exposes deterministic split targets and moves one tab | Pending |
| `layout.spec.ts` | applying the Review preset preserves resources and installs its vertical center topology | Pending |
| `layout.spec.ts` | the local default preset drives an explicit frame reset | Pending |
| `layout.spec.ts` | custom presets synchronize while defaults and group limits remain window-local | Pending |
| `layout.spec.ts` | Layout settings controls keep their container-preset max-widths | Pending |
| `layout.spec.ts` | an accepted side-group overage is grandfathered without allowing further growth | Pending |
| `layout.spec.ts` | a narrow viewport compresses locally without rewriting recursive topology | Pending |
| `layout.spec.ts` | frontend windows keep chat and file placement independent | Pending |
| `layout.spec.ts` | layout survives a transport reconnect and remains writable | Pending |
| `layout.spec.ts` | another window cannot cancel or rearrange an active tab drag | Pending |
| `layout.spec.ts` | another window cannot cancel or adopt an active side resize | Pending |
| `layout.spec.ts` | local layout transitions with no gesture in progress never announce a canceled drag | Pending |
| `layout.spec.ts` | a local transition during a side resize cancels the gesture and says so | Pending |
| `layout.spec.ts` | a tab drag reveals every valid destination subtly, then emphasizes the one under the pointer | Pending |
| `layout.spec.ts` | the hidden bottom drop zone wins overlapping terminal targets and reveals its frame group | Pending |
| `line-width-settings.spec.ts` | line-width controls validate drafts, converge on broadcasts, and persist | Pending |
| `line-width-settings.spec.ts` | the file width wraps source and updates an already-mounted editor | Pending |
| `line-width-settings.spec.ts` | the default file width wraps both sides of a long-line diff | Pending |
| `line-width-settings.spec.ts` | chat uses the selected measure and optionally exceeds a narrow pane | Pending |
| `live-refresh.spec.ts` | worktree changes on disk appear live in Specs, Files, Changes, and an open file tab | Pending |
| `live-refresh.spec.ts` | churn canary: a write storm coalesces to a few frames and the host stays responsive | Pending |
| `markdown-alerts.spec.ts` | renders GitHub-style alert callouts in the rendered markdown view | Pending |
| `markdown-links.spec.ts` | a parent-relative file link cannot escape into browser navigation | Pending |
| `markdown-links.spec.ts` | relative links, images, and heading anchors work in the rendered markdown view | Pending |
| `markdown-mermaid.spec.ts` | renders mermaid fences as diagrams in the rendered markdown view | Pending |
| `message-actions.spec.ts` | a large user message with an agent reply collapses, and Show more re-expands it | Pending |
| `message-actions.spec.ts` | a huge message expands into a bounded, scrollable body instead of a giant row | Pending |
| `message-actions.spec.ts` | a large user message with no agent reply stays expanded | Pending |
| `message-actions.spec.ts` | a short user message has no collapse controls | Pending |
| `message-actions.spec.ts` | only the round's final agent answer carries a copy action, not intermediate narration | Pending |
| `message-actions.spec.ts` | copy actions share the content line at the assistant left and user right without overlap | Pending |
| `message-actions.spec.ts` | copy actions copy the full source of both user and agent messages | Pending |
| `message-actions.spec.ts` | an unbounded transcript keeps the user message within the visible pane | Pending |
| `new-workspace.spec.ts` | the dialog lists local branches (no stray origin) and creates a worktree | Ported; the refresh button's transient `refreshing=true` is not observed (no DOM mutation observer), only its settled state |
| `new-workspace.spec.ts` | folder-mode Start with an empty prompt lands in a fresh chat in the Default workspace | Ported |
| `new-workspace.spec.ts` | a project's committed skills are gated behind trust, then autocomplete | Ported |
| `new-workspace.spec.ts` | the start prompt shares template completion and slot behavior without live-only commands | Ported |
| `new-workspace.spec.ts` | Enter in the prompt creates; Shift+Enter inserts a newline | Ported |
| `new-workspace.spec.ts` | a base whose fetch fails reports git's error, not a request timeout | Ported |
| `new-workspace.spec.ts` | the branch picker groups by host-supplied remotes and creates from the selected ref | Ported; cmdk group headings become `branch-group` test ids |
| `new-workspace.spec.ts` | opening New Workspace prefetches a stale default before create | Ported |
| `new-workspace.spec.ts` | opening New Workspace prefetches a missing default tracking ref | Ported |
| `new-workspace.spec.ts` | a pasted image in the workspace dialog rides along into the first chat turn | Ported; the paste delivers a PNG file through the input's native paste handler |
| `new-workspace-shortcut.spec.ts` | Mod+N opens the Create workspace dialog for the selected project from the Welcome screen, and Escape closes it | Not applicable: the native client has no keyboard shortcuts yet |
| `new-workspace-shortcut.spec.ts` | The Mod+Alt+N alias opens the same dialog and Mod+Shift+N does not | Not applicable: the native client has no keyboard shortcuts yet |
| `new-workspace-shortcut.spec.ts` | Mod+N works inside an active workspace | Not applicable: the native client has no keyboard shortcuts yet |
| `plan-open-pr.spec.ts` | Open PR: no origin errors, with origin pushes, re-press follows the same branch | Pending |
| `plan-open-pr.spec.ts` | Open PR is disabled in the Default workspace, whose branch is its own base branch | Pending |
| `plan-ask.spec.ts` | a pending ask_user_question is answerable from the plan page | Pending |
| `plan-ask.spec.ts` | the plan shows the agent's latest message when it isn't asking or on a step | Pending |
| `plan-review.spec.ts` | reviewable steps show the reviewed counter, Start review, and the settled Verified state | Pending |
| `plan-review.spec.ts` | a branch commit no step owns shows under 'Committed outside the plan' and is reviewable | Pending |
| `plan-review.spec.ts` | the plan page groups items into a Session block and Done, and adds a task inline | Pending |
| `plan-review.spec.ts` | plan items can be removed, and the add box takes multi-line input (Enter adds, Shift+Enter wraps) | Pending |
| `plan-review.spec.ts` | an empty plan's idle line is a click target that opens the add input | Pending |
| `plan-review.spec.ts` | a completed plan turns the Session into a chat composer instead of an idle line | Pending |
| `plan-review.spec.ts` | a re-opened plan keeps the completion note on the page, marked stale, but out of the export | Pending |
| `port-block.spec.ts` | same worktree converges on the same block, across repeated claims | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | two live worktrees preferring the same slot get distinct blocks | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | logical lanes on one live worktree get distinct sticky blocks | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | a stale claim (its worktree path is gone) is reclaimed | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | a logical lane becomes stale with its real worktree, not its synthetic key | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | assignments are sticky: a displaced worktree never migrates to its freed predecessor slot | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | duplicate claims for one worktree are deduped to the lowest slot | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | slot scan wraps past the last slot | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | a missing registry dir is created on first claim | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | a crashed holder's lock (dead pid) is broken immediately, not waited out | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | a live holder is never usurped — the claim times out loudly instead | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | breaking is serialized: a foreign break-token wedges breaking into the loud timeout | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | forced two-reclaimer interleaving: a stale break decision cannot delete a successor's lock | Not applicable: tests the Playwright harness itself, not the client |
| `port-block.spec.ts` | a garbled lock (unreadable owner) is broken only once it is old | Not applicable: tests the Playwright harness itself, not the client |
| `preview-tabs.spec.ts` | a single click previews into one reusable slot, a double click keeps the tab | Pending |
| `preview-tabs.spec.ts` | a double click claims the slot on its way to keeping the tab, at any latency | Pending |
| `preview-tabs.spec.ts` | a double click on an unopened file sends exactly one fs.readFile | Pending |
| `preview-tabs.spec.ts` | a browse the user has navigated away from is dropped, not activated on arrival | Pending |
| `preview-tabs.spec.ts` | of two browse clicks in flight at once, the later one wins | Pending |
| `preview-tabs.spec.ts` | a keep that lands first does not invalidate a browse requested after it | Pending |
| `preview-tabs.spec.ts` | a newer tab click cancels an older preview-tab settle timer | Pending |
| `preview-tabs.spec.ts` | the Specs panel shares the one slot, and closing the preview tab releases it | Pending |
| `privacy.spec.ts` | privacy controls additional data without disabling basics and persists across reload | Ported |
| `projects.spec.ts` | opens a git repo as a project via the directory picker | Ported |
| `projects.spec.ts` | opens a project from an explicit host path | Ported; focus assertion dropped (the bridge cannot observe native focus) |
| `projects.spec.ts` | picker failure falls back to host-path entry on every host platform | Ported |
| `projects.spec.ts` | manual path from the rail supersedes a picker started from Welcome | Ported; the held reply goes through the runner's wire proxy |
| `projects.spec.ts` | opening a non-git folder offers to initialise a repo, then opens it end-to-end | Ported |
| `projects.spec.ts` | rail expansion is per-browser view state that survives a reload | Ported; reload is an app relaunch that keeps its preferences |
| `projects.spec.ts` | activating a workspace in one project keeps the other project's rail expansion | Ported; list-item containment becomes the workspace row's project attribute |
| `projects.spec.ts` | project context actions stay compact and close/reopen is lossless across clients | Ported with a second app instance as observer; focus return, CSS opacity, Shift+F10/ContextMenu keys, touch pointer timing, icon counts and ARIA roles dropped (no native counterpart through the bridge) |
| `provider-apikey.spec.ts` | configures a provider by API key through the login dialog (secret prompt → success) | Pending |
| `provider-apikey.spec.ts` | the OAuth-only fake offers no API-key entry (flags derive from Provider.auth alone) | Pending |
| `provider-login.spec.ts` | signs in through the OAuth dialog (select → open-URL + paste → success), then signs out | Pending |
| `provider-login.spec.ts` | cancelling the OAuth dialog aborts the login and leaves the provider unconfigured | Pending |
| `reload-navigation.spec.ts` | reloading from the older of two chats returns to that exact chat without rail clicks | Pending |
| `reload-navigation.spec.ts` | a directly opened exact-chat fragment restores that chat; two tabs keep independent routes | Pending |
| `reload-navigation.spec.ts` | missing chat, workspace, and project fall back to the nearest valid location | Pending |
| `reload-navigation.spec.ts` | a transient workspace read failure preserves the URL and restores after reconnect | Pending |
| `reload-navigation.spec.ts` | a failed exact-chat transcript waits for reconnect instead of duplicating its read | Pending |
| `reload-navigation.spec.ts` | user navigation while the restore read is delayed wins over the late response | Pending |
| `reload-navigation.spec.ts` | reload from a file tab restores its shared placement under the workspace route | Pending |
| `reload-navigation.spec.ts` | workspace rows still list after a reload restore (the light list is complete) | Pending |
| `review-settings.spec.ts` | Review settings: model + effort render and the auto-fix toggle persists across a reload | Pending |
| `review-settings.spec.ts` | Review settings: the agent-review toggle persists across a reload | Pending |
| `review.spec.ts` | selection → icon → inline composer → draft; the tab wears the violet Review flag | Pending |
| `review.spec.ts` | a Monaco draft card keeps its mid-edit textarea across a sibling review push (zone reconcile) | Pending |
| `review.spec.ts` | sidebar: an accordion — the active reviewed file's section auto-unfolds; a row click folds/unfolds | Pending |
| `review.spec.ts` | the editor context menu carries Comment on selection — the «+»'s twin, one composer | Pending |
| `review.spec.ts` | the Review panel carries its own send buttons: per-file at the file level, Send all at the files level | Pending |
| `review.spec.ts` | line-anchored comment re-anchors when the file changes (moved → outdated) | Pending |
| `review.spec.ts` | preview mode: selecting rendered text comments on the mapped source lines | Pending |
| `review.spec.ts` | cards drawn in the preview reserve their height in the source view — and back (no overlay) | Pending |
| `review.spec.ts` | preview selection stays honest: a dragged piece stays a piece, and the composer's region mark is a rail, not a wash | Pending |
| `review.spec.ts` | an in-flow card never halves a code fence — the rest of the document stays prose | Pending |
| `review.spec.ts` | a draft card edits in place; a sent comment can't be edited | Pending |
| `review.spec.ts` | the diff's ORIGINAL (left) side is its own anchor space — base, never remapped | Pending |
| `review.spec.ts` | resolved comments sink into a muted Resolved section (TODO Done style) | Pending |
| `review.spec.ts` | Clear replaces the review for every connected client | Pending |
| `review.spec.ts` | a draft is server truth: a second client converges by push, and a cold reload re-hydrates it | Pending |
| `review.spec.ts` | Done is undone by a fresh remark: the file re-lists the moment a new comment lands | Pending |
| `settings.spec.ts` | settings shows the Local GitHub status block and degrades gh gracefully | Ported |
| `shard-runner.spec.ts` | one macOS runner owns one pid-scoped idle-sleep assertion | Not applicable: tests the Playwright harness itself, not the client |
| `shard-runner.spec.ts` | a macOS assertion that exits during startup fails the runner | Not applicable: tests the Playwright harness itself, not the client |
| `shard-runner.spec.ts` | every public browser E2E command preloads the idle-sleep assertion | Not applicable: tests the Playwright harness itself, not the client |
| `shard-runner.spec.ts` | automatic shard count budgets two CPUs per browser/host pair and stays bounded | Not applicable: tests the Playwright harness itself, not the client |
| `shard-runner.spec.ts` | focused Playwright arguments default serial while explicit counts win | Not applicable: tests the Playwright harness itself, not the client |
| `shard-runner.spec.ts` | runner flags are consumed without changing Playwright arguments | Not applicable: tests the Playwright harness itself, not the client |
| `shard-runner.spec.ts` | invalid or conflicting shard overrides fail loudly | Not applicable: tests the Playwright harness itself, not the client |
| `shell.spec.ts` | renders the branded shell and, with no workspace, the Welcome screen | Ported; CSS custom property, SVG fill and favicon checks become the logo's resolved colour and size (no favicon natively) |
| `skill-invocation.spec.ts` | a persisted expanded skill renders as one collapsed invocation with its request visible | Pending |
| `specs-panel.spec.ts` | Specs tab renders the worktree's spec tree and opens a spec as an editor tab | Pending |
| `specs-panel.spec.ts` | Specs offers Retry only after its automatic graph read fails | Pending |
| `specs-panel.spec.ts` | a failed automatic Specs update keeps the previous tree until Retry succeeds | Pending |
| `subagent-settings.spec.ts` | a maximal unbroken workspace name stays contained on a phone-sized settings pane | Pending |
| `subagent-settings.spec.ts` | global and workspace subagent choices converge from authoritative pushes | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › full lifecycle: filter, pick, fill, tab to the default, and send strips no markers | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › a template file added outside the app appears on the next menu open | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › typing after ArrowRight-collapsing the marker selection is never deleted by the send | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › tabbing out of a filled slot mirrors its text into a sibling sharing its group | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › the highlight backdrop tints each gap and tracks the active slot as Tab steps through | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › the slot backdrop shares dynamic textarea geometry and capped scrolling | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › sending directly (no Tab) still mirrors a filled slot's text into its same-group sibling | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › differing per-occurrence defaults stay independent through Tab and a direct Send (no edit) | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › editing one default occurrence provides the argument and mirrors it into the group-mate on Tab | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › Escape ends the session and leaves the text as-is | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › a wholesale replacement of the draft ends the session instead of tracking a meaningless range | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › picking a template replaces whatever draft was already there | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › the merged menu still shows non-template commands | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › filling an unfilled slot across several keystrokes never steals characters from a zero-gap sibling | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › sending with a live unfilled marker strips it and collapses the doubled space to exactly one | Pending |
| `templates-compose.spec.ts` | prompt templates in the composer › Escape closes the history overlay without ending an active slot session | Pending |
| `templates-manage.spec.ts` | templates management › Global empty state offers starter templates; adding them fills the composer's / menu | Pending |
| `templates-manage.spec.ts` | templates management › global template: create shows up in the composer's / menu, edit updates it, delete removes it from both | Pending |
| `templates-manage.spec.ts` | templates management › frontmatter round-trip: picking a saved template gets the body verbatim, and an edit-save cycle never grows it | Pending |
| `templates-manage.spec.ts` | templates management › an invalid template name shows an inline error instead of saving | Pending |
| `templates-manage.spec.ts` | templates management › a project-scoped template is written into the worktree and shows up in the Files tree | Pending |
| `templates-manage.spec.ts` | templates management › history overlay: save-as-template opens the shared editor prefilled with the selected prompt | Pending |
| `templates-manage.spec.ts` | templates management › a project template shadowing a same-named global one leaves both visible and independently editable | Pending |
| `templates-manage.spec.ts` | templates management › editing a template whose frontmatter fence is past the listing scan window keeps its metadata | Pending |
| `templates-manage.spec.ts` | templates management › editing a hand-created template with a whitespace-bearing name round-trips to the same file | Pending |
| `terminals.spec.ts` | a workspace opens a terminal automatically, rooted in the worktree, with working I/O | Pending |
| `terminals.spec.ts` | a shell start failure explains recovery and retries the same tab | Pending |
| `terminals.spec.ts` | xterm uses the shared quiet rail and directional curtains | Pending |
| `terminals.spec.ts` | terminals are workspace-scoped and survive workspace switches | Pending |
| `terminals.spec.ts` | multiple terminals per workspace keep independent buffers and can be closed | Pending |
| `terminals.spec.ts` | the terminal's shell counts characters, not bytes | Pending |
| `terminals.spec.ts` | a shell survives a trip to Project Home and back | Pending |
| `terminals.spec.ts` | historical terminal queries do not become input on remount | Pending |
| `terminals.spec.ts` | rapid re-entry never spawns a second shell | Pending |
| `terminals.spec.ts` | a shell survives a page reload | Pending |
| `terminals.spec.ts` | a terminal's output never reaches another client | Pending |
| `terminals.spec.ts` | a tab says so when its shell exits | Pending |
| `terminals.spec.ts` | Ctrl+C still interrupts while an input method is active | Pending |
| `terminals.spec.ts` | a shell that dies while detached is not re-attached as if alive | Pending |
| `terminals.spec.ts` | a shell survives losing the connection and reconnecting | Pending |
| `terminals.spec.ts` | a terminal attach response lost with its socket is replayed exactly once | Pending |
| `terminals.spec.ts` | final shell output is delivered before exit after reconnect | Pending |
| `terminals.spec.ts` | a second client takes a terminal over and the first is told | Pending |
| `terminals.spec.ts` | closing a tab with a running process asks first | Pending |
| `terminals.spec.ts` | a rejected forced close stays correlated and permits a clean retry | Pending |
| `terminals.spec.ts` | closing an idle tab does not ask | Pending |
| `terminals.spec.ts` | a terminal opened in one browser never creates placement in another | Pending |
| `terminals.spec.ts` | a shell that dies during a reclaim is not presented as alive | Pending |
| `theme.spec.ts` | appearance switches a discovered theme and persists it across reload | Pending |
| `theme.spec.ts` | system mode follows each client and retains its explicit pair | Pending |
| `theme.spec.ts` | Monaco opens files and re-themes under every discovered manifest | Pending |
| `theme.spec.ts` | selected workspace tabs keep their surface and edge marker in high contrast | Pending |
| `tool-file-links.spec.ts` | assistant Markdown opens safe relative files without navigating the browser | Pending |
| `tool-file-links.spec.ts` | structured tool paths reuse the preview tab while rich tool results stay intentional | Pending |
| `tool-result-images.spec.ts` | an image tool result previews inline and opens full screen | Pending |
| `topbar-chrome.spec.ts` | ordinary browsers have a fixed themed header with zero native insets | Pending |
| `topbar-chrome.spec.ts` | live safe areas on either edge preserve header and workbench geometry | Not applicable: injects the browser shell's CSS window-chrome insets; AppKit owns the native title bar and traffic lights |
| `topbar-chrome.spec.ts` | the action cluster keeps Update, quota Retry and Settings out of the drag region | Not applicable: exercises the desktop shell's native update bridge and CSS drag regions, which the RN app does not have |
| `topbar-chrome.spec.ts` | native updates progress from explicit download through install and restart | Not applicable: exercises the desktop shell's native update bridge, which the RN app does not host |
| `try-again.spec.ts` | a final agent failure offers Try again as an ordinary visible prompt | Pending |
| `typography.spec.ts` | welcome hero renders the generated brand style | Pending |
| `typography.spec.ts` | dialog title and card title share one typography | Pending |
| `typography.spec.ts` | entity rows, branch metadata and eyebrows are proportional | Pending |
| `typography.spec.ts` | Monaco and xterm render the generated code family and size | Pending |
| `typography.spec.ts` | the chat and document markdown surfaces each wear their own prose system | Pending |
| `typography.spec.ts` | document headings are larger than document body text | Pending |
| `typography.spec.ts` | the chat prose system stays compact | Pending |
| `typography.spec.ts` | typography survives a narrow mobile viewport without clipping or overflow | Pending |
| `typography.spec.ts` | bold inside prose changes weight only — in both prose systems | Pending |
| `typography.spec.ts` | a Tailwind utility at a call site overrides the semantic default it names | Pending |
| `welcome.spec.ts` | opens a clean ThinkRail with no projects imported | Ported |
| `welcome.spec.ts` | the Welcome provider warning only shows when no provider is connected, and opens Settings | Ported |
| `welcome.spec.ts` | Settings → Providers lists in-app auth options | Ported |
| `welcome.spec.ts` | a real provider's API key round-trips through the login dialog (add in Settings, sign out) | Ported; secret prompts use the app's own `NSSecureTextField` component |
| `welcome.spec.ts` | clicking Sign in (Settings) opens the in-app login dialog, and Cancel dismisses it | Ported |
| `welcome.spec.ts` | Settings → Providers offers JetBrains AI with host-authoritative Central guidance | Ported |
| `welcome.spec.ts` | a project with specs offers Start building over Set up, beside the project-folder fork | Ported |
| `welcome.spec.ts` | a project without specs suggests setting it up | Ported |
| `welcome.spec.ts` | opening a non-git folder from the Welcome screen offers to initialise a repo | Ported |
| `welcome.spec.ts` | clicking a project returns to its Welcome, deselecting the active workspace | Ported |
| `workspace-actions.spec.ts` | Open in launches the detected editor detached at the worktree path | Ported |
| `workspace-actions.spec.ts` | Copy path copies the worktree's absolute path to the clipboard | Ported; reads the system pasteboard, which the runner restores after each case |
| `workspace-actions.spec.ts` | a managed workspace can rename its display label inline without changing Git | Ported; focus and full selection are read from the focused native text view |
| `workspace-actions.spec.ts` | an open inline rename survives reconnect | Ported; the runner's wire proxy drops the connection and holds the reconnect |
| `workspace-actions.spec.ts` | the Default workspace's kebab menu offers only non-mutating actions | Ported |
| `workspace-actions.spec.ts` | right-click opens the workspace's kebab menu without activating it | Ported |
| `workspace-actions.spec.ts` | the kebab is hover-only ONLY on devices that actually have hover — never invisible by default | Ported as the kebab's `visible` attribute; CSS media-query inspection has no native counterpart (macOS always has hover) |
| `workspace-activity.spec.ts` | a failed run marks its workspace row, and the mark outlives both the tab and the workspace | Pending |
| `workspace-activity.spec.ts` | an unanswered question marks the row as waiting for you | Pending |
| `workspace-activity.spec.ts` | waiting outranks failed in one workspace, and the glyph names the whole breakdown | Pending |
| `workspace-activity.spec.ts` | deleting the marked chat clears the row | Pending |
| `workspace-activity.spec.ts` | a collapsed project row carries the rollup, so activity survives folding the project away | Pending |
| `workspace-activity.spec.ts` | a never-opened chat's failure reaches the rail from disk, without entering its workspace | Pending |
| `workspace-activity.spec.ts` | a newer fine chat supersedes an older failure — the worktree stops reading as failed | Pending |
| `workspace-lifecycle.spec.ts` | workspace removal propagates — no zombie row in a second tab | Ported with a second app instance |
| `workspace-lifecycle.spec.ts` | workspace rename propagates live and rehydrates a tab that missed a later snapshot | Ported with a second app instance behind its own wire proxy |
| `workspace-lifecycle.spec.ts` | removing the active workspace restores the previously selected workspace | Ported |
| `workspace-lifecycle.spec.ts` | workspace creation propagates to a second tab's rail | Ported with a second app instance |
| `workspace-tabs.spec.ts` | editor tabs are scoped to the active workspace | Pending |
| `workspace-tabs.spec.ts` | the selected side tool follows workspace switches | Pending |
| `workspace-tabs.spec.ts` | switching workspaces re-targets the mounted workbench instead of remounting it | Pending |
| `workspace-tabs.spec.ts` | a same-id terminal body remounts instead of carrying across workspaces | Pending |
| `workspaces.spec.ts` | opens and safely forgets an existing user-owned worktree | Ported; focus assertion dropped, disabled state read from the candidate's `disabled` attribute |
| `workspaces.spec.ts` | an attached worktree cannot also be opened as a project | Ported |
| `workspaces.spec.ts` | creates, removes, and re-creates worktree workspaces (no branch collision) | Ported; the alertdialog role becomes the `confirm-dialog` test id |
