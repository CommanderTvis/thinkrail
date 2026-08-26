---
id: submodule-server-projects
type: submodule-design
status: active
title: projects — git repos as projects
parent: module-server
depends-on: [module-contracts]
tags: [v1, public-surface-checked]
---

## Responsibility

Keep one stable registry of known projects — a git repository or a plain folder, either one — expose its
open and recent views, and open/close a project without breaking its workspace identity.

## Boundary

- **Owns:** resolve every external project-folder input against the **host filesystem** before inspecting
  or mutating it: host-absolute paths pass, exact `~` and `~/…` expand against the host account, and every
  other relative path is rejected rather than interpreted against the host process cwd. The same resolved
  path feeds `openProject`, `inspectProjectPath`, and `initProject`, so their classifications and actions
  cannot disagree. It then locates a git root when there is one (`git rev-parse --show-toplevel`), dedupes by
  root, assigns
  a stable unique readable `slug`; `getProjects` (all known records, with slug backfill), `listProjects`
  (open records only, by `lastOpened`), and `listRecentProjects` (open + closed, by `lastOpened`). A
  persisted optional **`Project.closed: true`** is the entire membership state: absence means open, so
  existing records migrate as open. **`openProject`** finds a known root even when closed, clears
  `closed`, bumps `lastOpened`, preserves its id, persists, and publishes the full snapshot; **`closeProject`**
  marks that same record closed and publishes it without deleting the project, repository, workspace
  records, or live runtimes. **One cwd, one ThinkRail identity:** `openProject` rejects a root already
  held as some workspace's `worktreePath` — pi keys chat transcripts by *directory*, so a second identity
  on an owned folder would serve that workspace's chats as its own and have them purged when either side
  is archived. Compared **canonically** (a managed worktree's stored path is composed, `--show-toplevel`
  answers symlink-resolved) and only **after** the reopen above, whose own Default workspace legitimately
  holds the project folder. The workspace-side half of the same door is `openExistingWorktree`
  ([[submodule-server-workspaces]]); reading the workspace records for it stays within the `persistence`
  dep — this module still never imports its sibling. `setProjectPublisher` is the host-injected push seam;
  this module never imports `host`. It also owns **`inspectProjectPath`** (classify a path — `repo` /
  `initable` / `missing` / `notDirectory` — the diagnosis `openProject`'s caller reaches for after a
  genuine failure, and the question `initProject` asks itself before deciding whether it has anything to
  do). ("Does the project have specs?" is **not** computed here — `host` answers the lazy
  `project.hasSpecs` query via `spec.projectHasSpecs`, keeping this module free of any spec dependency.)
  Project records also own the persisted project-level skill-admission state: trust is granted explicitly
  and revocably; the grant snapshots the currently discovered project aliases as acknowledged so later
  arrivals remain pending; and disabled skill/group sets form the project baseline beneath any workspace
  override. The host composes discovery with these mutation operations; this module stores no skill catalog
  and imports no agent code.
- **Becoming a repo is one verb; making the folder is another.** `initProject(path)` turns an existing
  directory into a project — `git init -b main` plus a root commit, or, for a directory that is already a
  repo, just `openProject`. `createProject(parentPath, name)` is the "New Project" door: it validates the
  typed name as a *single path segment* (a `/` or `\`, `.`, `..`, empty, or a NUL is refused rather than
  silently resolved — a name is not a path, and `join` would happily walk out of the parent), refuses a
  target that already exists rather than adopting or merging into it, `mkdir`s it, and then delegates. The
  split keeps **one** definition of what becoming a repo means, so the two doors can never drift into
  disagreeing about it. A failed init `rmdir`s the folder this call just made — an empty directory it
  created and nothing else, so the failure leaves no debris and can never remove a user's files.
- **The root commit is the feature, not a nicety.** Without it HEAD is unborn, and *every* git-backed
  surface fails at once: `createWorkspace` cannot branch (the user meets
  [[submodule-server-workspaces]]'s refusal), Changes reports `fatal: bad revision 'main'`, and the
  spec-first path is dead on arrival — a brand-new project is unusable in the exact moment it is created.
  `--allow-empty` is what makes it honest: the history starts, but no file is invented, so the working
  tree stays entirely the user's to fill. It is **best-effort** — a machine with no usable git identity
  (or a signing key behind a hardware unlock that is not present) leaves the repository and the project,
  never the failure, and `createWorkspace`'s named refusal remains the safety net for that case.
- **A plain folder opens directly — never an offer to `git init` an existing one.** That stays true and is
  a different question from the verb above: ThinkRail creates a repo only where it also created the
  folder, and never proposes to initialize a folder the user pointed it at. `openProject` no longer requires
  a git root: it stats the path itself (existence + is-a-directory), resolves the git toplevel *if there
  is one*, and falls back to the canonicalized path otherwise. `Project.hasGit` records the outcome —
  `false` for a plain folder, omitted (never `true`) for a real repo, restamped on every reopen so a
  folder that gains a `.git` later (the user ran `git init` themselves, outside ThinkRail) picks it back
  up without needing to be closed and reopened. Every consumer downstream — the Default workspace's
  `branch`/`baseBranch` (`workspaces/SPEC.md`'s `folderTruth`), git status/diff reads — was **already**
  written to fail soft rather than throw when there is no repository (a pre-existing property of the
  `git` sub-module, not something this change added); the only actual gate was this module's own
  `openProject`, and removing it is what makes a plain folder usable end to end. What is not attempted:
  making git-only surfaces (Changes, the branch picker, workspace/worktree creation) *disappear* for a
  plain-folder project beyond the one hiding this module directly enables (see `ProjectTree.tsx`'s
  `project.hasGit === false` gate on the two worktree-creation menu items) — those panels still render for
  one, and read as "git status failed" rather than "there is no git here."
- **Public surface (barrel):** `openProject`, `initProject`, `createProject`, `listProjects`,
  `listRecentProjects`, `closeProject`, `getProjects`, `setProjectPublisher`, `inspectProjectPath`,
  `setProjectTrust`, `setProjectSkillEnabled`, `setProjectGroupEnabled`, `acknowledgeProjectSkills`.
- **Allowed deps:** `persistence`; the `git` sub-module (shared `git()` runner, which now owns the
  environment its children spawn under — this module passes none); `contracts` (`Project`, `ProjectPathStatus`); Node/Bun.
- **Forbidden:** `host`; sibling features other than `git` (`workspaces` depends on `projects`, never the
  reverse).
