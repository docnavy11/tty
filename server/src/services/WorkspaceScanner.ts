import { readdirSync, statSync, existsSync, realpathSync, readFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { homedir } from 'os'

// The directory holding the user's projects, one level of subdirectories deep.
// This is deliberately NOT tty's `projects` table: that models a *group of
// session definitions*, which is a different thing that happens to share a
// name. A workspace is just a folder on disk you might want a shell in.
export const WORKSPACE_ROOT = resolve(
  process.env.TTY_PROJECTS_ROOT ?? join(process.env.HOME ?? homedir(), 'projects')
)

export interface Workspace {
  // Path relative to WORKSPACE_ROOT. Nested workspaces carry a '/', e.g.
  // "acme/billing-api".
  name: string
  path: string
  // Newest mtime found under this workspace, ISO 8601. Null when the directory
  // could not be read.
  mtime: string | null
  git: boolean
  branch?: string
}

// Directories that are build output, dependency trees or data — never projects,
// and expensive to walk. Added after an earlier version happily reported
// `someproject/__pycache__` as a project of its own.
const JUNK = new Set([
  '__pycache__', 'node_modules', '.venv', 'venv', 'data', 'results',
  'dist', 'build', 'out', 'logs', 'tmp', 'cache', '.git', '.idea', '.vscode',
  'target', 'coverage', '.next', '.cache', 'vendor',
])

// Files excluded from the recency signal because they are written in bulk by
// tooling rather than by the user. Writing CLAUDE.md into 31 repos in one pass
// made 14 long-dormant projects look freshly active in the inventory — the
// metric was measuring the tool, not the work. Same reasoning for
// .gitignore, which gets templated across repos the same way.
const NOT_ACTIVITY = new Set(['CLAUDE.md', '.gitignore', '.DS_Store'])

// A directory is a project if it carries any project marker. One that carries
// none but whose children do is a *container* directory and gets descended into
// — a folder holding five sibling repos is exactly this. Scanning only one
// level deep would report it as a single opaque blob.
const MARKERS = [
  '.git', 'deploy.sh', 'package.json', 'requirements.txt', 'pyproject.toml',
  'docker-compose.yml', 'docker-compose.yaml', 'README.md', 'Dockerfile',
  'go.mod', 'Cargo.toml', 'Makefile',
]

function isProject(dir: string): boolean {
  return MARKERS.some(m => existsSync(join(dir, m)))
}

function mtimeMs(p: string): number {
  try { return statSync(p).mtimeMs } catch { return 0 }
}

// How deep, and how many entries, the recency walk is allowed to cover.
//
// A one-level scan was tried first and got the answer visibly wrong: tty's own
// source lives in server/src/services, so editing it moved nothing at the top
// level and the project sorted 18th minutes after being worked on. Real edits
// land a few directories down, so the walk has to go there.
//
// The budget is what keeps it cheap. JUNK already removes node_modules and the
// other big trees, and the result is cached, so these limits are a backstop
// against one pathological directory rather than the normal cost.
const MAX_DEPTH = 4
const MAX_ENTRIES = 4000

// Newest meaningful mtime in a workspace.
//
// Also folds in .git/index and .git/HEAD: staging, committing or switching
// branch is activity even when it rewrites nothing the walk would see.
function recencyOf(dir: string): number {
  let newest = mtimeMs(dir)
  let budget = MAX_ENTRIES

  const walk = (current: string, depth: number): void => {
    if (depth > MAX_DEPTH || budget <= 0) return
    let entries: import('fs').Dirent[]
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      if (budget <= 0) return
      const name = entry.name
      if (JUNK.has(name) || NOT_ACTIVITY.has(name)) continue
      budget--
      const full = join(current, name)
      if (entry.isDirectory()) {
        // A directory's own mtime changes when entries are added or removed,
        // which is activity in its own right.
        const m = mtimeMs(full)
        if (m > newest) newest = m
        walk(full, depth + 1)
      } else if (entry.isFile()) {
        const m = mtimeMs(full)
        if (m > newest) newest = m
      }
      // Symlinks are deliberately not followed: they can point outside the
      // workspace, or into a cycle.
    }
  }

  walk(dir, 1)

  for (const gitFile of ['index', 'HEAD']) {
    const m = mtimeMs(join(dir, '.git', gitFile))
    if (m > newest) newest = m
  }

  return newest
}

function gitBranch(dir: string): string | undefined {
  try {
    const content = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim()
    const m = /^ref: refs\/heads\/(.+)$/.exec(content)
    // Detached HEAD stores a bare sha; show the short form rather than nothing.
    return m ? m[1] : content.slice(0, 7)
  } catch { return undefined }
}

let cache: { at: number; value: Workspace[] } | null = null
const CACHE_MS = Math.max(
  1000,
  parseInt(process.env.TTY_WORKSPACE_CACHE_MS ?? '', 10) || 15_000,
)

export function scanWorkspaces(force = false): Workspace[] {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value

  const out: Workspace[] = []

  let top: string[] = []
  try { top = readdirSync(WORKSPACE_ROOT) } catch { return [] }

  for (const name of top) {
    if (name.startsWith('.') || JUNK.has(name)) continue
    const dir = join(WORKSPACE_ROOT, name)
    let isDir = false
    try { isDir = statSync(dir).isDirectory() } catch { continue }
    if (!isDir) continue

    if (isProject(dir)) {
      out.push(describe(name, dir))
      continue
    }

    // Container directory: report its children too. All of them, not only the
    // ones matching isProject() — a child with no markers is exactly the kind
    // of un-versioned work worth surfacing (infra/collect.sh silently dropped
    // `startupmap-be` for precisely this reason).
    const kids: Workspace[] = []
    let any = false
    let children: string[] = []
    try { children = readdirSync(dir) } catch { /* fall through to self */ }
    for (const kid of children) {
      if (kid.startsWith('.') || JUNK.has(kid)) continue
      const kidDir = join(dir, kid)
      try { if (!statSync(kidDir).isDirectory()) continue } catch { continue }
      kids.push(describe(`${name}/${kid}`, kidDir))
      if (isProject(kidDir)) any = true
    }
    // The container itself stays in the list alongside its children. It is not
    // a project, but this list exists to answer "where do I want a shell", and
    // a container directory is a real answer: a session may already be sitting
    // in it, with nowhere to be shown.
    out.push(describe(name, dir))
    if (any) out.push(...kids)
  }

  out.sort((a, b) => (b.mtime ?? '').localeCompare(a.mtime ?? ''))
  cache = { at: Date.now(), value: out }
  return out
}

function describe(name: string, dir: string): Workspace {
  const ms = recencyOf(dir)
  const git = existsSync(join(dir, '.git'))
  return {
    name,
    path: dir,
    mtime: ms > 0 ? new Date(ms).toISOString() : null,
    git,
    branch: git ? gitBranch(dir) : undefined,
  }
}

// Reject anything outside the root before it reaches a pty's cwd. The path
// arrives from the client, so "it came from a list we generated" is not a
// guarantee — resolve symlinks and check containment explicitly.
export function resolveWorkspacePath(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0) return null
  let real: string
  try {
    real = realpathSync(resolve(input))
    if (!statSync(real).isDirectory()) return null
  } catch {
    return null
  }
  const root = realpathSync(WORKSPACE_ROOT)
  if (real !== root && !real.startsWith(root + sep)) return null
  return real
}
