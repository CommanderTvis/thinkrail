# Gotchas

- For disappearing terminals, fix the state transition that drops their placements. Do not add recovery UI or a new user workflow unless explicitly requested.

- Treat `BLUEPRINT.md` as navigation to its AI author. It must not open as a standalone rendered document; the Blueprint UI is the author chat or terminal's companion.
- Validate user-visible navigation in the running UI or E2E, not only with opener unit tests.
- A terminal in the host catalog is not necessarily present in the layout. Navigation must attach and reveal the resource, not merely select its terminal key or focus a companion.
- Blueprint authors belong in the main column. A test that only checks that the terminal and Blueprint are visible can pass while both are incorrectly placed in the bottom dock; assert the layout region.
- When comparing terminal image paste across agents, trace both consumers of an empty bracketed paste. A text-only terminal can still trigger a CLI's native clipboard-image fallback; missing image transport alone does not explain different behavior.

- When screenshot text is absent from a repository search, check ignored source files and the current checkout before concluding that the UI belongs to another repository. Exclude generated builds and dependencies explicitly when using `--no-ignore`.
