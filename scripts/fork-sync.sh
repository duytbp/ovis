#!/bin/sh
# Moves the fork's own commits onto a new base (FORK.md). The fork's main is one linear stack: a base
# (upstream's main, or the tip of an upstream PR branch the fork carries before it merges), then
# the fork's own commits. refs/fork/base marks where those start; this rebases
# refs/fork/base..main onto the new base and moves the mark there. Commits of a PR upstream
# squash-merged sit below the mark, so they drop out once the new base is upstream's main.
#   scripts/fork-sync.sh [<new base>]   default: upstream/main, after git fetch upstream
#   FORK_BRANCH (main), UPSTREAM_REMOTE (upstream)
# The whole script is one function, read before it runs: the rebase rewrites this file.
set -eu

run() {
  branch=${FORK_BRANCH:-main}
  upstream=${UPSTREAM_REMOTE:-upstream}
  mark=refs/fork/base
  # the base a rebase that stopped was moving to, until a run sees it finished or abandoned
  pending=refs/fork/base-next
  cd "$(git rev-parse --show-toplevel)"
  git_dir=$(git rev-parse --git-dir)
  if [ -d "$git_dir/rebase-merge" ] || [ -d "$git_dir/rebase-apply" ]; then
    fail "a rebase is in progress: finish it (git rebase --continue) or drop it (git rebase --abort), then run this again"
  fi
  current=$(git branch --show-current)
  [ "$current" = "$branch" ] || fail "check out $branch first (this is ${current:-a detached HEAD})"
  [ -z "$(git status --porcelain --untracked-files=all)" ] || fail "the tree has local changes; commit or stash them first"
  old=$(git rev-parse -q --verify "$mark^{commit}") || fail "no $mark yet. Mark where the fork's own commits start on $branch (the tip of the PR branches it carries, or where it leaves upstream's main), for example:
  git update-ref $mark \$(git merge-base $branch $upstream/main)
then run this again."

  # a run that stopped on a conflict: once its rebase finished, the mark moves to where it went
  if next=$(git rev-parse -q --verify "$pending^{commit}"); then
    git update-ref -d "$pending"
    if [ "$next" != "$old" ] && git merge-base --is-ancestor "$next" HEAD; then
      git update-ref "$mark" "$next" "$old"
      echo "fork-sync: the rebase onto $(git rev-parse --short "$next") was finished; $mark moved there"
      [ $# -eq 0 ] && return 0
      old=$next
    fi
  fi

  base=${1:-$upstream/main}
  git fetch "$upstream"
  # a base on another remote (refs/remotes/<remote>/<branch> or <remote>/<branch>) is fetched too
  remote=$(printf '%s\n' "$base" | sed -n 's|^\(refs/remotes/\)\{0,1\}\([^/]*\)/.*|\2|p')
  if [ -n "$remote" ] && [ "$remote" != "$upstream" ] && git remote | grep -qx "$remote"; then git fetch "$remote"; fi
  new=$(git rev-parse -q --verify "$base^{commit}") || fail "$base names no commit"

  # remembered conflict resolutions replay by themselves on the next sync
  git config rerere.enabled true
  git update-ref "$pending" "$new"
  if ! git rebase --onto "$new" "$old" "$branch"; then
    fail "the rebase stopped on a conflict. Resolve it (git add, then git rebase --continue), or give up with git rebase --abort. Then run scripts/fork-sync.sh again: after a finished rebase it moves $mark (run it with no base); after an aborted one, give it the same base to start over."
  fi
  git update-ref -d "$pending"
  git update-ref "$mark" "$new" "$old"
  echo "fork-sync: $branch is $(git rev-list --count "$new..$branch") fork commits on $base ($(git rev-parse --short "$new")); $mark moved there"
}
fail() { echo "fork-sync: $*" >&2; exit 1; }

run "$@"
