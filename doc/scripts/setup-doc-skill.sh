#!/usr/bin/env bash
set -euo pipefail

# ── setup-doc-skill.sh ─────────────────────────────────
# Creates an agent skill that exposes your zudo-doc
# documentation as a knowledge base, then symlinks it into
# the user-scope skills directory (~/.claude/skills/ and/or
# ~/.codex/skills/).
# ────────────────────────────────────────────────────────

TARGET_MODE="auto"

# Tracked-skill linking (zudolab/zudo-doc#3156) is default-ON: #3152 asked for
# automatic linking of a site's own hand-written skills, not just the
# generated one. --no-link-tracked-skills opts out (e.g. this monorepo's own
# npm scripts, which would otherwise export ~20 project-specific skills into
# the user's global skills dir -- see zudolab/zudo-doc#3157).
LINK_TRACKED_SKILLS="true"

# Accept --silent (alias -y) for parity with the consuming-site convention:
# scaffolded sites expose `setup:doc-skill-silent` = `bash scripts/setup-doc-skill.sh
# --silent`. This script is already non-interactive (the skill name is deterministic
# — see below), so the flag is a no-op here; it is consumed only so it is never
# mistaken for the positional skill-name override (`$1`).
while [ $# -gt 0 ]; do
  case "$1" in
    --silent|-y) shift ;;
    --target)
      shift
      if [ $# -eq 0 ]; then
        echo "Error: --target requires one of: auto, claude, codex, both" >&2
        exit 1
      fi
      TARGET_MODE="$1"
      shift
      ;;
    --target=*)
      TARGET_MODE="${1#--target=}"
      shift
      ;;
    --no-link-tracked-skills) LINK_TRACKED_SKILLS="false"; shift ;;
    --) shift; break ;;
    -*) echo "Error: unknown flag '$1'" >&2; exit 1 ;;
    *) break ;;
  esac
done

case "$TARGET_MODE" in
  auto|claude|codex|both) ;;
  *)
    echo "Error: --target must be one of: auto, claude, codex, both" >&2
    exit 1
    ;;
esac

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Read project name from package.json
PROJECT_NAME=$(node -e "console.log(require('$ROOT_DIR/package.json').name || 'my-project')")

# Pre-#3154 default: always `<projectName>-wisdom`, which doubles the suffix
# when PROJECT_NAME already ends in "-wisdom" (e.g. "zudo-test-wisdom" ->
# "zudo-test-wisdom-wisdom"). Kept around only to detect leftover legacy
# directories from that behavior -- see the migration-warning block below.
LEGACY_DEFAULT_SKILL_NAME="${PROJECT_NAME}-wisdom"
if [[ "$PROJECT_NAME" == *-wisdom ]] || [[ "$PROJECT_NAME" == "wisdom" ]]; then
  DEFAULT_SKILL_NAME="$PROJECT_NAME"
else
  DEFAULT_SKILL_NAME="$LEGACY_DEFAULT_SKILL_NAME"
fi

echo ""
echo "=== zudo-doc Skill Setup ==="
echo ""

# Skill name is DETERMINISTIC and suffix-aware: verbatim when PROJECT_NAME
# already ends in "-wisdom" (or is exactly "wisdom"), otherwise
# "<projectName>-wisdom" (zudolab/zudo-doc#3154). The scaffolded .gitignore
# (emitted by create-zudo-doc's packages/create-zudo-doc/src/scaffold.ts,
# which computes the same name) hard-codes this exact rule, so the generated
# skill directory must match it — an interactive prompt would let the name
# drift from the gitignore entry and leave the skill showing as untracked
# (zudolab/zudo-doc#2173). An explicit override is still allowed via the first
# CLI arg or the SKILL_NAME env var (consumers who override must also update
# their .gitignore), but never via an interactive prompt.
SKILL_NAME="${1:-${SKILL_NAME:-$DEFAULT_SKILL_NAME}}"

# Validate skill name (allow only alphanumeric, hyphens, underscores)
if [[ ! "$SKILL_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Error: Skill name may only contain letters, numbers, hyphens, and underscores."
  exit 1
fi

# Migration warning (zudolab/zudo-doc#3154, D3): the suffix-aware rule above is
# a BREAKING change for existing "*-wisdom" projects. Their .gitignore pins the
# old, doubled name, so after picking up this fix they get a NEW, unignored
# skill directory while the stale doubled one remains on disk -- the symptom
# moves rather than disappears. Detect that and tell the user what to do by
# hand; never delete anything automatically, it is the user's tree.
# Three independent symptoms are checked, and ANY one of them fires the
# warning: stale ignore rules (the .gitignore still names the doubled skill --
# on its own that already means the NEW directory is unignored, which is the
# whole problem, even when the legacy directory was never generated or has
# already been deleted), a leftover legacy directory, and a leftover global
# symlink. Only the steps for the symptoms actually found are printed.
# Only fires when SKILL_NAME still equals DEFAULT_SKILL_NAME -- an explicit
# $1/SKILL_NAME override means the derived name (and this guidance about it)
# doesn't apply to what the script is actually about to create.
if [ "$SKILL_NAME" = "$DEFAULT_SKILL_NAME" ] && [ "$DEFAULT_SKILL_NAME" != "$LEGACY_DEFAULT_SKILL_NAME" ]; then
  # The ignore rules are repo-level, so this is checked once rather than per
  # target -- both ".claude/skills/<name>/" and ".codex/skills/<name>/" entries
  # live in the same file (create-zudo-doc emits it at the project root).
  # -F: PROJECT_NAME comes from package.json and may contain regex characters.
  legacy_gitignore=""
  if [ -f "$ROOT_DIR/.gitignore" ] &&
    grep -qF "skills/$LEGACY_DEFAULT_SKILL_NAME/" "$ROOT_DIR/.gitignore"; then
    legacy_gitignore="$ROOT_DIR/.gitignore"
  fi

  legacy_dirs=()
  legacy_links=()
  for target in claude codex; do
    legacy_dir="$ROOT_DIR/.$target/skills/$LEGACY_DEFAULT_SKILL_NAME"
    if [ -d "$legacy_dir" ]; then
      legacy_dirs+=("$legacy_dir")
    fi
    # -L only (which also catches a dangling link): this script only ever
    # creates SYMLINKS in the global skills dir, so a real file or directory
    # sitting at that path is user-owned and none of our business -- calling it
    # a "stale global symlink" and suggesting `rm -f` would advise deleting
    # someone else's file (and would simply fail for a directory).
    legacy_global_link="$HOME/.$target/skills/$LEGACY_DEFAULT_SKILL_NAME"
    if [ -L "$legacy_global_link" ]; then
      legacy_links+=("$legacy_global_link")
    fi
  done

  if [ -n "$legacy_gitignore" ] ||
    [ "${#legacy_dirs[@]}" -gt 0 ] ||
    [ "${#legacy_links[@]}" -gt 0 ]; then
    echo "WARNING: stale references to the legacy skill name '$LEGACY_DEFAULT_SKILL_NAME' detected."
    echo "  The skill-name derivation rule changed; this project's skill now resolves to:"
    echo "  $DEFAULT_SKILL_NAME"
    echo "  Found:"
    if [ -n "$legacy_gitignore" ]; then
      echo "  - stale ignore rules in $legacy_gitignore"
    fi
    if [ "${#legacy_dirs[@]}" -gt 0 ]; then
      for legacy_dir in "${legacy_dirs[@]}"; do
        echo "  - legacy skill directory: $legacy_dir"
      done
    fi
    if [ "${#legacy_links[@]}" -gt 0 ]; then
      for legacy_global_link in "${legacy_links[@]}"; do
        echo "  - stale global symlink: $legacy_global_link"
      done
    fi
    echo "  Manual steps:"
    step=1
    if [ -n "$legacy_gitignore" ]; then
      echo "  $step. Update the ignore rules for '$LEGACY_DEFAULT_SKILL_NAME' to '$DEFAULT_SKILL_NAME' in $legacy_gitignore."
      step=$((step + 1))
    fi
    if [ "${#legacy_dirs[@]}" -gt 0 ]; then
      for legacy_dir in "${legacy_dirs[@]}"; do
        echo "  $step. Delete the stale directory once migrated: rm -rf \"$legacy_dir\""
        step=$((step + 1))
      done
    fi
    if [ "${#legacy_links[@]}" -gt 0 ]; then
      for legacy_global_link in "${legacy_links[@]}"; do
        echo "  $step. Remove the stale global symlink: rm -f \"$legacy_global_link\""
        step=$((step + 1))
      done
    fi
    echo ""
  fi
fi

# Resolve the main repo root (handles git worktrees correctly)
# Use the main worktree path so symlinks survive worktree removal. Read the
# porcelain form: the plain listing is space-separated, so a checkout path
# containing a space would be cut short (#4705). When the main entry is a bare
# repository it has no checkout to link into, so fall back to the current
# worktree's top level.
WORKTREE_PORCELAIN="$(git -C "$ROOT_DIR" worktree list --porcelain)"
REPO_ROOT=""
MAIN_WORKTREE_IS_BARE="false"
while IFS= read -r porcelain_line; do
  [ -z "$porcelain_line" ] && break
  case "$porcelain_line" in
    "worktree "*) REPO_ROOT="${porcelain_line#worktree }" ;;
    bare) MAIN_WORKTREE_IS_BARE="true" ;;
  esac
done <<< "$WORKTREE_PORCELAIN"
if [ "$MAIN_WORKTREE_IS_BARE" = "true" ] || [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(git -C "$ROOT_DIR" rev-parse --show-toplevel)"
fi

# Path from the repository root to the project directory: "" at the repo
# root, "doc/" (trailing slash) when the project lives in a subdirectory
# (nested layout, #2918). `rev-parse --show-prefix` is relative to the
# CURRENT worktree's top level, so combining it with REPO_ROOT (the MAIN
# worktree root, above) reconstructs the equivalent path there even when
# running from inside a different worktree.
PROJECT_PREFIX="$(git -C "$ROOT_DIR" rev-parse --show-prefix)"
MAIN_PROJECT_DIR="$REPO_ROOT/${PROJECT_PREFIX}"
MAIN_PROJECT_DIR="${MAIN_PROJECT_DIR%/}"
# REPO_DOCS_DIR is set below, once the config parse resolves the real
# (possibly custom) docsDir -- no hardcoded fallback is defined here so a
# short-circuited parse fails loudly instead of silently reverting to
# src/content/docs (#4047).

# Read the current locale map from the project's config. The generated config
# puts `defaultLocale`, `docsDir`, and `locales` directly in `zudoDoc({...})`.
# The showcase keeps those fields in its imported `src/config/settings.ts`, so
# the parser also follows relative imports from `zfb.config.ts`.
#
# This deliberately does NOT walk `src/content/docs-*`: that naming convention
# also matches version snapshots such as `docs-v1-ja`, which are not current
# locale roots. The config map is the only source of truth.
#
# The node call is wrapped in a function rather than inlined into the
# assignment's `$( ... )`: bash 3.2 (stock macOS /bin/bash) does not honour a
# heredoc opened inside a command substitution -- it scans the heredoc body as
# shell text, and the JavaScript below contains an odd number of backticks
# (template literals), so the whole FILE fails to parse. Keeping the heredoc at
# statement level sidesteps that parser bug while preserving stdin execution,
# argument indexing, and node's exit status through the assignment.
read_config_locale_data() {
  node - "$ROOT_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const configPath = path.join(root, "zfb.config.ts");

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// Mask comments and quoted strings while preserving braces/newlines. This is
// enough lexical shielding for the plain-data config shapes the generator
// emits, and keeps nested `versions[].locales` objects distinguishable.
function maskSource(source) {
  const chars = source.split("");
  let state = "code";
  let quote = "";
  for (let i = 0; i < chars.length; i += 1) {
    const current = chars[i];
    const next = chars[i + 1];
    if (state === "line-comment") {
      if (current === "\n") state = "code";
      else chars[i] = " ";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 1;
        state = "code";
      } else if (current !== "\n") {
        chars[i] = " ";
      }
      continue;
    }
    if (state === "string") {
      if (current === "\\") {
        chars[i] = " ";
        if (i + 1 < chars.length && chars[i + 1] !== "\n") {
          chars[i + 1] = " ";
          i += 1;
        }
      } else if (current === quote) {
        chars[i] = " ";
        state = "code";
      } else if (current !== "\n") {
        chars[i] = " ";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 1;
      state = "line-comment";
    } else if (current === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 1;
      state = "block-comment";
    } else if (current === "'" || current === '"' || current === "`") {
      quote = current;
      chars[i] = " ";
      state = "string";
    }
  }
  return chars.join("");
}

function braceDepths(masked) {
  const depths = [];
  let depth = 0;
  for (let i = 0; i < masked.length; i += 1) {
    depths[i] = depth;
    if (masked[i] === "{") depth += 1;
    else if (masked[i] === "}") depth -= 1;
  }
  return depths;
}

function matchingBrace(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === "{") depth += 1;
    else if (masked[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function spreadZudoDocObjectRanges(masked, depths) {
  const ranges = [];
  const spreadPattern = /\.\.\.\s*zudoDoc\s*\(\s*/g;
  let match;
  while ((match = spreadPattern.exec(masked)) !== null) {
    const open = match.index + match[0].length;
    if (masked[open] !== "{") continue;
    const close = matchingBrace(masked, open);
    if (close < 0) continue;
    ranges.push({ open, close, propertyDepth: depths[open] + 1 });
  }
  return ranges;
}

function isTopLevelSetting(index, depths, spreadRanges) {
  if (depths[index] === 1) return true;
  return spreadRanges.some(
    ({ open, close, propertyDepth }) =>
      index > open && index < close && depths[index] === propertyDepth,
  );
}

function topLevelObject(source, property) {
  const masked = maskSource(source);
  const depths = braceDepths(masked);
  const spreadRanges = spreadZudoDocObjectRanges(masked, depths);
  const propertyPattern = new RegExp(`\\b${property}\\s*:`, "g");
  let match;
  while ((match = propertyPattern.exec(masked)) !== null) {
    // Direct settings objects use depth 1; spread zudoDoc settings use their
    // explicitly identified object depth. Nested locale maps stay ignored.
    if (!isTopLevelSetting(match.index, depths, spreadRanges)) continue;
    let open = match.index + match[0].length;
    while (/\s/.test(masked[open] ?? "")) open += 1;
    if (masked[open] !== "{") continue;
    const close = matchingBrace(masked, open);
    if (close < 0) continue;
    return { text: source.slice(open, close + 1) };
  }
  return null;
}

function topLevelString(source, property) {
  const masked = maskSource(source);
  const depths = braceDepths(masked);
  const spreadRanges = spreadZudoDocObjectRanges(masked, depths);
  const propertyPattern = new RegExp(`\\b${property}\\s*:`, "g");
  let match;
  while ((match = propertyPattern.exec(masked)) !== null) {
    if (!isTopLevelSetting(match.index, depths, spreadRanges)) continue;
    const tail = source.slice(match.index + match[0].length).trimStart();
    const quote = tail[0];
    if (quote !== "\"" && quote !== "'") continue;
    const end = tail.indexOf(quote, 1);
    if (end > 1) return tail.slice(1, end);
  }
  return null;
}

function parseLocaleEntries(objectText) {
  const masked = maskSource(objectText);
  const depths = braceDepths(masked);
  const keyPattern = /(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][A-Za-z0-9_$-]*))\s*:/g;
  const entries = [];
  let match;
  while ((match = keyPattern.exec(objectText)) !== null) {
    if (depths[match.index] !== 1) continue;
    let open = match.index + match[0].length;
    while (/\s/.test(masked[open] ?? "")) open += 1;
    if (masked[open] !== "{") continue;
    const close = matchingBrace(masked, open);
    if (close < 0) continue;
    const entry = objectText.slice(open, close + 1);
    const dir = entry.match(/\bdir\s*:\s*["']([^"']+)["']/)?.[1];
    const code = match[1] ?? match[2] ?? match[3];
    if (!code || !dir) continue;
    const normalizedDir = path.posix.normalize(dir.replace(/^\.\//, ""));
    if (
      !normalizedDir ||
      normalizedDir === "." ||
      normalizedDir.startsWith("../") ||
      normalizedDir.startsWith("/")
    ) continue;
    if (!entries.some((item) => item.code === code || item.dir === normalizedDir)) {
      entries.push({ code, dir: normalizedDir });
    }
  }
  return entries;
}

function resolveImport(rootDir, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(rootDir, specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const sources = [];
const seen = new Set();
function addSource(file) {
  if (!file || seen.has(file)) return;
  const source = read(file);
  if (source === null) return;
  seen.add(file);
  sources.push({ file, source });
}

addSource(configPath);
const configSource = read(configPath) ?? "";
const importPattern = /\bfrom\s*["']([^"']+)["']/g;
let importMatch;
while ((importMatch = importPattern.exec(configSource)) !== null) {
  addSource(resolveImport(root, importMatch[1]));
}

let defaultLocale = null;
let docsDir = null;
let localeObject = null;
for (const { source } of sources) {
  if (defaultLocale === null) defaultLocale = topLevelString(source, "defaultLocale");
  if (docsDir === null) docsDir = topLevelString(source, "docsDir");
  if (localeObject === null) localeObject = topLevelObject(source, "locales");
}

if (defaultLocale === null && docsDir === null && localeObject === null) {
  console.error(
    "no explicit locale settings found in zfb.config.ts; assuming defaults (en, src/content/docs, no additional locales)",
  );
}

console.log(`default\t${defaultLocale ?? "en"}`);
console.log(`docs\t${docsDir ?? "src/content/docs"}`);
if (localeObject) {
  for (const { code, dir } of parseLocaleEntries(localeObject.text)) {
    console.log(`locale\t${code}\t${dir}`);
  }
}
NODE
}
CONFIG_LOCALE_DATA="$(read_config_locale_data)"

DEFAULT_LOCALE="en"
DOCS_DIR_REL="src/content/docs"
LOCALE_CODES=()
LOCALE_DIR_RELS=()
while IFS=$'\t' read -r record_type record_value record_extra; do
  case "$record_type" in
    default) [ -n "$record_value" ] && DEFAULT_LOCALE="$record_value" ;;
    docs) [ -n "$record_value" ] && DOCS_DIR_REL="$record_value" ;;
    locale)
      # Locale maps contain additional locales only. Ignore a malformed
      # duplicate of defaultLocale rather than creating two docs links.
      [ -n "$record_value" ] || continue
      [ "$record_value" = "$DEFAULT_LOCALE" ] && continue
      duplicate="false"
      # bash 3.2 under `set -u` treats "${arr[@]}" on an EMPTY array as an
      # unbound variable, so the length guard is required, not cosmetic.
      if [ "${#LOCALE_CODES[@]}" -gt 0 ]; then
        for existing_code in "${LOCALE_CODES[@]}"; do
          [ "$existing_code" = "$record_value" ] && duplicate="true"
        done
      fi
      [ "$duplicate" = "true" ] && continue
      LOCALE_CODES+=("$record_value")
      LOCALE_DIR_RELS+=("$record_extra")
      ;;
  esac
done <<< "$CONFIG_LOCALE_DATA"

# Validate and enumerate the same tree the docs symlink targets (main), not
# the worktree the script runs from, so the category list in SKILL.md matches
# what the link shows (#4704, as #4698/#4702 for AUTHORING.md and locales).
REPO_DOCS_DIR="$MAIN_PROJECT_DIR/$DOCS_DIR_REL"
DOCS_DIR="$REPO_DOCS_DIR"

# Validate docs directory exists
if [ ! -d "$DOCS_DIR" ]; then
  echo "Error: Documentation directory not found at $DOCS_DIR"
  exit 1
fi

# Helper: physical (symlink-resolved) form of a directory path; echoes the
# input unchanged when it is not a directory. Stock macOS ships no realpath(1)
# and BSD readlink has no -f, so `cd` + `pwd -P` is the only resolver available
# on every platform this script targets (it is also copied verbatim into
# downstream projects by create-zudo-doc, so it must stay portable).
physical_dir() {
  local resolved
  # Fall back to the input on ANY resolution failure -- notably an unreadable
  # directory, where `cd` fails and the subshell yields "". Without the
  # non-empty guard, two different unreadable paths would both collapse to ""
  # and compare EQUAL, silently skipping a link that should have been created.
  # stderr is suppressed so a permission-denied probe stays quiet.
  if [ -d "$1" ] && resolved="$(cd "$1" 2>/dev/null && pwd -P)" &&
    [ -n "$resolved" ]; then
    printf '%s\n' "$resolved"
  else
    printf '%s\n' "$1"
  fi
}

# Helper: replace a symlink at the given path; refuse to remove real files or directories
ensure_symlink() {
  local link_path="$1"
  local target="$2"
  if [ -L "$link_path" ]; then
    rm "$link_path"
  elif [ -e "$link_path" ]; then
    echo "Error: '$link_path' already exists and is not a symlink. Move or remove it and rerun setup:doc-skill." >&2
    exit 1
  fi
  ln -s "$target" "$link_path"
}

# Helper: link a single tracked (hand-written) skill into the global skills
# dir WITHOUT ever deleting something this script doesn't own
# (zudolab/zudo-doc#3156, D4). Unlike ensure_symlink (rm -rf-based -- safe
# only for the generated skill, whose global name this project owns),
# tracked-skill names are arbitrary and could collide with a user-owned
# global skill or a name already claimed by another project, so an existing
# entry that isn't already our own correct link is left untouched, with a
# warning.
safe_link_tracked_skill() {
  local link_path="$1"
  local link_target="$2"
  local skill_name="$3"
  local target="$4"

  if [ -L "$link_path" ]; then
    local current_target
    current_target="$(readlink "$link_path")"
    # Compare where the link actually LANDS, not the literal string it stores.
    # link_target is built from MAIN_PROJECT_DIR, which comes from
    # `git worktree list` and is therefore always PHYSICAL, while an existing
    # link may hold an unresolved path for the same directory. A raw string
    # compare then mis-reports our own correct link as foreign whenever the
    # project or its parents sit behind a symlink (macOS $TMPDIR: /var ->
    # /private/var; also a symlinked $HOME or repo checkout), so the link was
    # skipped with a spurious "already links to ..." warning instead of
    # no-opping (zudolab/zudo-doc#3156 D4).
    if [ "$current_target" = "$link_target" ] ||
      [ "$(physical_dir "$link_path")" = "$(physical_dir "$link_target")" ]; then
      return 0 # already correct -> no-op
    fi
    if [ -e "$link_path" ]; then
      echo "WARNING: [$target] skipping tracked skill '$skill_name': $link_path already links to $current_target"
      return 0
    fi
    # Dangling symlink (broken target) -> safe to replace.
    rm -f "$link_path"
    ln -s "$link_target" "$link_path"
    echo "  [$target] Linked tracked skill '$skill_name' -> $link_target"
    return 0
  fi

  if [ -e "$link_path" ]; then
    echo "WARNING: [$target] skipping tracked skill '$skill_name': $link_path is a real file/directory, not a symlink"
    return 0
  fi

  ln -s "$link_target" "$link_path"
  echo "  [$target] Linked tracked skill '$skill_name' -> $link_target"
}

# Locale links use the configured directory basename for the stable lookup
# name (`docs-ja`, `docs-de`, ...). If a project uses a custom directory whose
# basename is `docs` or collides with another map entry, fall back to a
# code-qualified name rather than guessing from a broad content-directory glob.
LOCALE_LINK_NAMES=()
locale_link_name() {
  local code="$1"
  local dir="$2"
  local name="${dir%/}"
  name="${name##*/}"
  [ -n "$name" ] || name="docs-$code"
  [ "$name" = "docs" ] && name="docs-$code"
  suffix=2
  while :; do
    collision="false"
    # Length guard: see the LOCALE_CODES loop above -- bash 3.2 under `set -u`
    # errors on "${arr[@]}" when the array is empty.
    if [ "${#LOCALE_LINK_NAMES[@]}" -gt 0 ]; then
      for existing in "${LOCALE_LINK_NAMES[@]}"; do
        if [ "$existing" = "$name" ]; then
          collision="true"
          break
        fi
      done
    fi
    [ "$collision" = "false" ] && break
    name="docs-$code-$suffix"
    suffix=$((suffix + 1))
  done
  printf '%s\n' "$name"
}

# LOCALE_PRESENT holds the ONE existence decision per locale that the
# guidance, the Japanese section, and generate_skill's symlink step all read,
# so the three can never disagree (#4047). It tests MAIN_PROJECT_DIR, the tree
# the locale symlinks target: testing ROOT_DIR from a linked worktree could
# link or mention a directory main lacks, or skip one main has (#4702, as
# #4698 for AUTHORING.md).
LOCALE_PRESENT=()
for locale_index in "${!LOCALE_CODES[@]}"; do
  locale_code="${LOCALE_CODES[$locale_index]}"
  locale_dir="${LOCALE_DIR_RELS[$locale_index]}"
  locale_link="$(locale_link_name "$locale_code" "$locale_dir")"
  LOCALE_LINK_NAMES+=("$locale_link")
  if [ -d "$MAIN_PROJECT_DIR/$locale_dir" ]; then
    LOCALE_PRESENT+=("true")
  else
    LOCALE_PRESENT+=("false")
  fi
done

locale_starter_note() {
  case "$1" in
    ja) echo "Japanese starter prose" ;;
    en) echo "English starter prose" ;;
    *) echo "English placeholder prose pending translation" ;;
  esac
}

# Build exact locale-map guidance for the generated skill. Entries come from
# configured `locales`, but only when LOCALE_PRESENT (above) says the
# directory exists, so the guidance can never point at a locale link that was
# never created (#4047).
LOCALE_GUIDANCE="- \`$DEFAULT_LOCALE\` (default): \`${DOCS_DIR_REL%/}/\` — \`/docs/...\` ($(locale_starter_note "$DEFAULT_LOCALE"))"
LOCALE_GUIDANCE+=$'\n'
for locale_index in "${!LOCALE_CODES[@]}"; do
  locale_code="${LOCALE_CODES[$locale_index]}"
  locale_dir="${LOCALE_DIR_RELS[$locale_index]}"
  [ "${LOCALE_PRESENT[$locale_index]}" = "true" ] || continue
  locale_link="${LOCALE_LINK_NAMES[$locale_index]}"
  locale_note="$(locale_starter_note "$locale_code")"
  LOCALE_GUIDANCE+="- \`$locale_code\`: \`${locale_dir%/}/\` — \`/$locale_code/docs/...\` (${locale_note}); lookup link: \`$locale_link/\`"
  LOCALE_GUIDANCE+=$'\n'
done

JA_DOCS_LINK=""
JA_DOCS_PATH=""
if [ "$DEFAULT_LOCALE" = "ja" ]; then
  JA_DOCS_LINK="docs"
  JA_DOCS_PATH="$DOCS_DIR_REL"
else
  for locale_index in "${!LOCALE_CODES[@]}"; do
    if [ "${LOCALE_CODES[$locale_index]}" = "ja" ]; then
      # Same LOCALE_PRESENT decision as the LOCALE_GUIDANCE loop above and
      # generate_skill's symlink step below (#4047).
      [ "${LOCALE_PRESENT[$locale_index]}" = "true" ] || break
      JA_DOCS_LINK="${LOCALE_LINK_NAMES[$locale_index]}"
      JA_DOCS_PATH="${LOCALE_DIR_RELS[$locale_index]}"
      break
    fi
  done
fi

# Discover top-level doc categories dynamically
DOC_TREE=""
for dir in "$DOCS_DIR"/*/; do
  [ -d "$dir" ] || continue
  dirname="$(basename "$dir")"
  DOC_TREE="${DOC_TREE}- ${dirname}/
"
done

# The SKILL.md "Format"/"Verify" steps must only reference commands that
# actually exist on the running project's package.json — a fresh
# create-zudo-doc scaffold has no format script at all, while this repo's own
# showcase exposes `format` (there is no `format:md` script anywhere, #2918).
# `format:md` is checked too in case a downstream project defines its own
# script under that literal name.
FORMAT_SCRIPT="$(node -e "
const scripts = (require('$ROOT_DIR/package.json').scripts) || {};
console.log(
  scripts.format ? 'format'
  : scripts['format:mdx'] ? 'format:mdx'
  : scripts['format:md'] ? 'format:md'
  : ''
);
")"
if [ -n "$FORMAT_SCRIPT" ]; then
  FORMAT_STEP="Run \`pnpm $FORMAT_SCRIPT\` to format the new/changed MDX files."
else
  FORMAT_STEP="No format script is configured for this project; formatting is optional."
fi

# Name the project directory explicitly so the instruction resolves correctly
# even when the project is nested inside a larger git repo (running `pnpm
# build` from the outer repo root would otherwise invoke the wrong
# package.json, #2918).
VERIFY_STEP="Run \`pnpm build\` from \`$MAIN_PROJECT_DIR\` to confirm the site builds correctly."

# Name the project's editorial policy when it uses the scaffold default
# (AUTHORING.md); otherwise defer to whatever policy the instruction files
# name. The four placement questions are embedded either way so Update mode
# never depends on a network connection. Test the same tree the pointer
# names (MAIN_PROJECT_DIR, like every other path in the skill text): checking
# ROOT_DIR from a linked worktree could name a file main lacks, or drop a
# pointer main has (#4698).
if [ -f "$MAIN_PROJECT_DIR/AUTHORING.md" ]; then
  POLICY_STEP="Read the editorial policy \`$MAIN_PROJECT_DIR/AUTHORING.md\` (categories, boundaries, URL and translation constraints)."
else
  POLICY_STEP="Read the project's editorial policy: the file that \`CLAUDE.md\`, \`AGENTS.md\`, or \`README.md\` in \`$MAIN_PROJECT_DIR\` names for adding or organizing docs. If none is named, treat category boundaries as undecided and rely on the questions below."
fi

resolve_targets() {
  case "$TARGET_MODE" in
    claude) echo "claude" ;;
    codex) echo "codex" ;;
    both) echo "claude codex" ;;
    auto)
      local has_claude=""
      local has_codex=""
      [ -d "$HOME/.claude" ] && has_claude="true"
      [ -d "$HOME/.codex" ] && has_codex="true"

      if [ "$has_claude" = "true" ] && [ "$has_codex" = "true" ]; then
        echo "claude codex"
      elif [ "$has_codex" = "true" ]; then
        echo "codex"
      else
        # Preserve the historical default for fresh machines and test homes.
        echo "claude"
      fi
      ;;
  esac
}

generate_skill() {
  local target="$1"
  local project_skills_dir="$ROOT_DIR/.$target/skills"
  local skill_dir="$project_skills_dir/$SKILL_NAME"
  local global_skills_dir="$HOME/.$target/skills"
  local assistant_label

  case "$target" in
    claude) assistant_label="Claude Code" ;;
    codex) assistant_label="Codex" ;;
    *) echo "Error: unknown target '$target'" >&2; exit 1 ;;
  esac

  mkdir -p "$skill_dir"

  ensure_symlink "$skill_dir/docs" "$REPO_DOCS_DIR"
  echo "  [$target] Created docs symlink -> $REPO_DOCS_DIR"

  for locale_index in "${!LOCALE_CODES[@]}"; do
    locale_code="${LOCALE_CODES[$locale_index]}"
    locale_dir="${LOCALE_DIR_RELS[$locale_index]}"
    locale_link="${LOCALE_LINK_NAMES[$locale_index]}"
    locale_target="$MAIN_PROJECT_DIR/$locale_dir"
    if [ "${LOCALE_PRESENT[$locale_index]}" = "true" ]; then
      ensure_symlink "$skill_dir/$locale_link" "$locale_target"
      echo "  [$target] Created $locale_link symlink for $locale_code -> $locale_target"
    else
      # Drop a link an earlier run left behind: SKILL.md no longer names it.
      [ -L "$skill_dir/$locale_link" ] && rm "$skill_dir/$locale_link"
      echo "  [$target] Skipping $locale_code link; configured directory not found at $locale_target"
    fi
  done

  cat > "$skill_dir/SKILL.md" << SKILLEOF
---
name: $SKILL_NAME
description: >-
  Search and reference documentation from the $PROJECT_NAME project.
  Use when answering questions about $PROJECT_NAME features, configuration,
  components, or usage patterns.
user-invocable: true
argument-hint: "[-u|--update] [topic keyword, e.g., 'configuration', 'sidebar', 'i18n']"
---

# $PROJECT_NAME Documentation Reference

Look up documentation from the $PROJECT_NAME project for $assistant_label.
Documentation base path: \`$DOCS_DIR_REL/\` (relative to the project root: \`$MAIN_PROJECT_DIR\`)

## Mode Detection

Parse the argument string for flags:

- If args start with \`-u\` or \`--update\`: enter **Update mode** (see below)
- Otherwise: enter **Lookup mode** (default)

Strip the flag from the remaining argument to get the topic keyword.

## Lookup Mode (default)

1. Find the relevant article(s) from the default \`docs/\` directory or one of the configured locale links listed below based on the topic
2. Read ONLY the specific article(s) you need — do NOT load all articles at once
3. Apply the information from the article when answering the user's question
4. Mention the source article path so the user can find it for further reading

## Update Mode (\`-u\` / \`--update\`)

The user has new information and wants to add or update documentation in this repo.

### Workflow

1. **Understand the new info**: Ask the user what they learned or want to
   document. The topic keyword (if provided) hints at the subject area.
2. **Find existing docs**: Search the default \`docs/\` directory or the exact configured locale link for articles related to
   the topic. Read them to understand what is already covered.
3. **Check placement and decide create vs update**: For a typo, wording, or
   formatting fix, update the article and skip the rest of this step.
   Otherwise: ${POLICY_STEP} Then answer:
   1. Who can do what with this content?
   2. Does an existing page already serve that role? If so, update it.
   3. Why this category, and is there a competing destination?
   4. Does this addition change what the category means?
   If the answers are clear, report the placement reason in one line. Only
   when there is evidence of a category conflict, duplication, a new independent
   cluster of reader tasks, or a findability problem, write the concrete reader
   problem and compare updating an existing article, improving while keeping
   the structure, a local reorganization, and related links or an index —
   keep the options that solve the problem, then prefer the smaller change.
   Read only the related or competing articles, and say what you surveyed.
   Keeping the structure is a valid result; do not decide by page count.
   If no existing page serves the role, create a new \`.mdx\` file in the
   subdirectory chosen above.
4. **Write the content**: Follow the doc-authoring rules in this project's CLAUDE.md (\`$MAIN_PROJECT_DIR/CLAUDE.md\`):
   - Required frontmatter: \`title\` (string). Always set \`sidebar_position\`.
     Optional: \`description\`, \`sidebar_label\`, \`tags\`, etc.
   - Do NOT use \`# h1\` in content — the frontmatter \`title\` renders as h1.
     Start with \`## h2\` headings.
   - Use available MDX components (\`<Note>\`, \`<Tip>\`, \`<Info>\`, \`<Warning>\`,
     \`<Danger>\`, \`<HtmlPreview>\`) where appropriate.
   - For live demos, use \`<HtmlPreview>\` with \`js\`/\`displayJs\` props.
   - Link to other docs using relative paths with \`.mdx\` extension.
5. **Update configured locale docs**: For every additional locale listed below,
   create or update the corresponding file under its exact configured directory,
   mirroring the default directory structure. Keep code blocks, Mermaid
   diagrams, and \`<HtmlPreview>\` blocks identical — only translate surrounding
   prose. The \`ja\` locale, when present, uses Japanese translation
   conventions. Other non-EN locales currently contain English placeholder prose
   pending translation; do not claim they are already translated. Exception:
   pages with \`generated: true\` skip translation.
6. **Format**: ${FORMAT_STEP}
7. **Verify**: ${VERIFY_STEP}

## Documentation Structure

The documentation is organized in MDX files under \`docs/\`:

\`\`\`
${DOC_TREE}\`\`\`

Browse the \`docs/\` directory to discover available articles. Each \`.mdx\` file
has YAML frontmatter with \`title\` and \`description\` fields that help identify
the right article to read.

## Configured Locales

The current locale map from \`zfb.config.ts\` is:

$LOCALE_GUIDANCE

Only these configured directories are current locale roots. Do not discover
additional roots with a \`src/content/docs-*\` glob: versioned trees such as
\`docs-v1\` or \`docs-v1-ja\` are snapshots, not current locales.
SKILLEOF

  if [ -n "$JA_DOCS_LINK" ]; then
    cat >> "$skill_dir/SKILL.md" << JAEOF

## Japanese Documentation

Japanese translations are available under \`$JA_DOCS_LINK/\` (configured path
\`$JA_DOCS_PATH\`). When the user is working in Japanese or asks for Japanese
content, prefer articles from \`$JA_DOCS_LINK/\`. This section exists only
because the config map contains the \`ja\` locale.
JAEOF
  fi

  echo "  [$target] Generated SKILL.md"

  mkdir -p "$global_skills_dir"
  ensure_symlink "$global_skills_dir/$SKILL_NAME" "$skill_dir"

  echo "  [$target] Project skill: $skill_dir"
  echo "  [$target] Global symlink: $global_skills_dir/$SKILL_NAME"
}

# Symlink the site's OWN hand-written skills into the global skills dir
# (zudolab/zudo-doc#3156). Discovery walks the target's own project skills
# directory dynamically -- not a hard-coded list, so it stays correct as
# sites add skills. Sources resolve through MAIN_PROJECT_DIR, not ROOT_DIR,
# the same way the generated skill's docs and configured-locale symlinks do (see the
# REPO_ROOT/MAIN_PROJECT_DIR comment above) so the links survive worktree
# removal. Target-local only: each target walks only its own
# ".$target/skills/" -- a missing directory is a silent no-op, and there is
# no ".claude" -> ".codex" fallback.
link_tracked_skills() {
  local target="$1"
  local skills_root="$MAIN_PROJECT_DIR/.$target/skills"
  local global_skills_dir="$HOME/.$target/skills"

  [ -d "$skills_root" ] || return 0

  mkdir -p "$global_skills_dir"

  local dir name
  for dir in "$skills_root"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"

    # Skip the just-generated skill (already linked above via ensure_symlink)
    # and the legacy doubled-suffix name (zudolab/zudo-doc#3154) -- otherwise
    # a stale leftover directory left by that rename gets misread as a
    # hand-written skill and exported globally, compounding both bugs.
    [ "$name" = "$SKILL_NAME" ] && continue
    [ "$name" = "$LEGACY_DEFAULT_SKILL_NAME" ] && continue

    # A candidate qualifies only if it contains SKILL.md -- iterating every
    # directory does not prove it is a skill.
    [ -f "${dir}SKILL.md" ] || continue

    safe_link_tracked_skill "$global_skills_dir/$name" "${dir%/}" "$name" "$target"
  done
}

read -r -a TARGETS <<< "$(resolve_targets)"
echo "Target: $TARGET_MODE -> ${TARGETS[*]}"
echo ""

for target in "${TARGETS[@]}"; do
  generate_skill "$target"
  if [ "$LINK_TRACKED_SKILLS" = "true" ]; then
    link_tracked_skills "$target"
  fi
done

echo ""
echo "Done! Skill '$SKILL_NAME' is ready."
echo ""
echo "Use --target claude, --target codex, or --target both to override auto-detection."
echo "Use --no-link-tracked-skills to skip linking this project's own hand-written skills."
echo "In Claude Code, use: /$SKILL_NAME <topic>"
echo "In Codex, mention the skill by name when asking about this documentation."
echo ""
