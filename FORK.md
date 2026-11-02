# duytbp/ovis

A personal fork of [devswha/ovis](https://github.com/devswha/ovis). The fork's `main` is upstream's
`main`, plus a few upstream PRs that haven't merged yet, plus the fork's own commits
([the stack](#the-stack)). In a clone, `origin` is the fork and `upstream` is devswha/ovis. Nothing
here goes upstream as a PR, and the fork has no releases or tags: an install follows `main`.

The fork's own code changes nothing about installing or updating Ovis. Remote PCs still get
upstream's runtime bundle, and the Rust PTY host still comes from upstream's
`v<package.json version>` release. When the fork's `crates/` match that release, the host installs;
otherwise terminals fall back to the Node sidecar.

## Install

The plugin id stays `devswha.ovis` (from `herdr-plugin.toml`), so the fork replaces an upstream
install. Stop the old one before removing it: if its server is still up, the old checkout keeps
serving and the new install's start leaves it alone.

```sh
herdr plugin action invoke devswha.ovis.stop
# keep the token and settings, in case the uninstall takes the config dir with it
cfg=$(herdr plugin config-dir devswha.ovis); cp -p "$cfg/.env" /tmp/ovis.env 2>/dev/null
herdr plugin uninstall devswha.ovis
herdr plugin install duytbp/ovis --ref main --yes
```

Always pass `--ref main`: neither `herdr plugin install --help` nor herdr's docs say which ref an
install without it checks out. A reinstall gets a new installation directory, so an update folder
an earlier install left under `~/.config/ovis/updates/` does not shadow the fork's checkout.

## Updates

Ovis's own updater (Settings → Updates) follows the `vX.Y.Z` tags on the checkout's `origin`, the
fork, and offers one only when the running commit is its ancestor. The fork carries the upstream
tags GitHub copied when it was made (`v0.4.17` to `v0.4.21`), all below `main`, so it reports up to
date; an upstream tag pushed later would sit off the fork's stack, and the updater would refuse it
as a downgrade. Still, push only `main` here: never `git push --tags`, `--follow-tags` or a tag of
upstream's. `scripts/fork-sync.sh` pushes nothing. Updating is `herdr plugin update devswha.ovis --yes`, which refetches the
ref recorded at install (`main`), then a restart of Ovis. On SER8, `~/.local/bin/herdr-ovis-update`
does both when the installed commit differs from `git ls-remote` of the fork's `main`, and checks
the server's health after; cron runs it daily at 04:15.

The same run brings the remote PCs along with `~/.local/bin/ovis-bridge-overlay`: it copies the
checkout's `server/` and `shared/` over a `-fork` copy of each PC's upstream `remote-vN` bundle and
restarts its bridge, skipping PCs already on the commit and those offline. The overlay carries code
only, so a fork commit that needs a server dependency upstream's bridge runtime lacks cannot ride it;
`ovis-bridge-overlay --undo <pc>` puts a PC back on upstream's bundle. Neither script lives in this
repository.

## The stack

The fork's `main` is one linear branch. From the bottom up:

1. `upstream/main`.
2. The commits of any upstream PR the fork carries before it merges, the topmost PR's on the one
   below it. When two carried PRs are separate branches of upstream's main, the fork joins them in a
   merge commit of its own, and that merge is the top of 2.
3. The fork's own fixes not yet upstream (today: the pinned agents card's inset). The four sidebar
   PRs of devswha/ovis#2617 merged upstream on 2026-11-05 and come with `upstream/main`.
4. The `fork:` commit: this file and `scripts/fork-sync.sh`.

`refs/fork/base` marks where the fork's own commits (3 and 4) start: the top of 2 while a PR is
carried, or `upstream/main` when none is. The fork's own work has no topic branches; it is
committed on `main` itself. Never push a carried PR's branch from here: that updates the upstream PR.

Set the mark once, before the first sync:

```sh
git update-ref refs/fork/base <tip of the last PR branch in the stack>
# or, with no PR branches carried:
git update-ref refs/fork/base $(git merge-base main upstream/main)
```

## Sync

```sh
git switch main
scripts/fork-sync.sh                                          # onto upstream/main (fetched first)
scripts/fork-sync.sh <the top of the PRs carried>                     # onto a PR's new tip
UNIT_TEST_WORKERS=2 flock /tmp/ovis-heavy.lock bun run check fast
git push --force-with-lease origin main
```

The script refuses to run off `main`, with local changes, or during a rebase. It fetches
`upstream`, plus the remote the given base is on. It then runs
`git rebase --onto <new base> refs/fork/base main` with rerere enabled and moves the mark to the
new base. Only the commits above the mark move, so whatever is below it is replaced by the new base.
A force push is fine for `main`, since every sync rebuilds it.

- **A PR branch gets new commits** (or is rebased): sync onto the new tip of the topmost PR branch
  still carried.
- **Upstream merges a PR** (squash-merged, so its commits never appear upstream as they are): sync
  onto the next PR branch still carried, or onto `upstream/main` when none is. The old PR commits
  sat below the mark, so they drop out instead of conflicting with the squash.
- **A conflict** stops the rebase. Resolve it, then `git add` and `git rebase --continue`, and run
  `scripts/fork-sync.sh` again with no base to move the mark. After a `git rebase --abort`, run it
  again with the same base. rerere replays a resolution it has seen before; `git add` it and
  continue.

Keep the fork's own commits small and to the side, so syncs stay clean.

Write no `#N`, `devswha/ovis#N`, `GH-N` or issue or PR URL in a commit message pushed here, on any
branch: GitHub links a fork's references to devswha/ovis, and every sync gives the commits new
hashes, so each push would add another "referenced this issue" line to the upstream issue or PR.
Say "devswha/ovis issue 2617" instead. File contents are not scanned, so FORK.md and DESIGN.md
may link freely.
