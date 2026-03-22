# WebTerminal — Requirements & Architecture

## Problem Statement

SSH sessions from a local machine die when the internet connection drops. A persistent proxy on a VPS holds SSH connections open, manages them as projects, and allows reconnection from any device — including mobile browsers — without the user managing tmux directly.

-----

## Concepts

|Concept                         |Description                                                                                                                                                         |
|--------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Project**                     |A named group of session definitions. Represents a working context (e.g. "QIS Staging", "sterk.studio Prod").                                                       |
|**Project Session (definition)**|A saved connection config within a project: host, user, auth, auto-commands, tab order. A blueprint.                                                                |
|**Active Session**              |A running instance of a project session: live SSH connection, tmux session on target, streamable to browser.                                                        |
|**Autostart**                   |Project flag. When proxy boots, autostart projects launch all their sessions immediately — no browser needed.                                                       |
|**Remember Open**               |Default behavior. Active sessions persist on the proxy regardless of browser state. Reopen browser → they're still there. Not a setting — it's how the system works.|

-----

## Requirements

### Core

|# |Requirement                                                                     |
|--|--------------------------------------------------------------------------------|
|R1|Browser-based terminal UI — works on desktop and mobile                         |
|R2|Multiple concurrent SSH sessions, organized by project, presented as tabs       |
|R3|Sessions survive browser disconnects, tab closes, device switches               |
|R4|Transparent session reattachment — user reopens browser, sessions are just there|
|R5|Tmux is used internally for persistence but never exposed to the user           |
|R6|Scroll-back history preserved across reconnects                                 |

### Projects

|#  |Requirement                                                                          |
|---|-------------------------------------------------------------------------------------|
|R7 |Projects group related session definitions (e.g. 3 servers for one environment)      |
|R8 |"Open project" launches all its sessions in parallel                                 |
|R9 |Autostart projects launch on proxy boot without browser interaction                  |
|R10|Active sessions persist until explicitly killed (remember open)                      |
|R11|Project dashboard shows status: running (N/M connected), not running, reconnecting   |
|R12|Ad-hoc sessions (not tied to a project) supported under an "Ungrouped" pseudo-project|

### Connection Management

|#  |Requirement                                                                                                                                |
|---|-------------------------------------------------------------------------------------------------------------------------------------------|
|R13|Session definitions include: host, port, user, auth method, auto-commands, tab order                                                       |
|R14|Support SSH key auth, password auth, and local (no SSH) connection types                                                                   |
|R15|Auto-commands execute on every fresh tmux creation (first connect + recovery)                                                              |
|R16|Session list persists across VPS/proxy restarts                                                                                            |
|R17|Idle session timeout with configurable TTL per project                                                                                     |
|R18|Manual session close/kill from the UI (single session or entire project)                                                                   |
|R56|SSH agent forwarding: proxy forwards its local SSH agent to target servers so git/SSH operations work without copying keys                 |
|R57|Quick-connect from tab bar: "+" button that accepts `user@host` or `local` for ad-hoc sessions without leaving the workspace               |
|R70|Local sessions: when target is the proxy server itself, spawn tmux directly (no SSH). File operations use local filesystem instead of SFTP.|

### Auto-Recovery

|#  |Requirement                                                                                               |
|---|----------------------------------------------------------------------------------------------------------|
|R19|When SSH to target drops, proxy auto-retries with exponential backoff (5s → 60s cap)                      |
|R20|If target rebooted (tmux gone), proxy creates new tmux session + runs auto-commands                       |
|R21|If target just had a network blip (tmux alive), proxy reattaches to existing tmux                         |
|R22|Session shows "reconnecting" status during retry, "unreachable" after max retries                         |
|R23|Max retry attempts configurable (default 60 ≈ ~30 min)                                                    |
|R58|Parallel boot recovery: on proxy restart, reconnect sessions concurrently (max 5 parallel SSH connections)|

### File Transfer

|#  |Requirement                                                             |
|---|------------------------------------------------------------------------|
|R24|Upload files from browser to target server via SFTP                     |
|R25|Download files from target server to browser via SFTP                   |
|R26|Simple UI: drag-and-drop upload, click-to-download file browser         |
|R27|Transfer progress indicator                                             |
|R28|Uses the existing SSH connection (SFTP subsystem), no extra ports needed|
|R29|Max upload size configurable (default 500MB)                            |

### Security

|#  |Requirement                                                                   |
|---|------------------------------------------------------------------------------|
|R30|Accessible only via Tailscale — no public internet exposure                   |
|R31|No auth layer needed — Tailscale network membership is the authentication     |
|R32|SSH keys stored on VPS filesystem, never sent to or from the browser          |
|R33|Fastify serves directly on Tailscale IP / MagicDNS hostname (no reverse proxy)|

### UX

|#  |Requirement                                                                                                   |
|---|--------------------------------------------------------------------------------------------------------------|
|R34|Mobile-friendly: touch scrolling, virtual key bar (Ctrl, Esc, Tab, arrow keys)                                |
|R35|Session status indicators (connected, reconnecting, unreachable)                                              |
|R36|Project switcher: home screen lists all projects with status                                                  |
|R37|Tab bar scoped to active project                                                                              |
|R38|Rename sessions and projects                                                                                  |
|R39|Tab ordering: drag-to-reorder in UI, persisted per project                                                    |
|R59|Global search: search terminal output across all sessions in the active project                               |
|R60|Mobile select mode: toggle that switches terminal from input mode to text selection mode for easier copy-paste|
|R61|Session log dump: button to export last N lines (default 10,000) of a session as a text file                  |

### Inline File Editor

|#  |Requirement                                                                     |
|---|--------------------------------------------------------------------------------|
|R62|File paths in terminal output are detected and rendered as clickable links      |
|R63|Clicking a file path opens the file in a side panel editor via SFTP             |
|R64|Syntax highlighting auto-detected from file extension (Monaco or CodeMirror)    |
|R65|Line number from stack trace (e.g. `auth.ts:47`) scrolled to and highlighted    |
|R66|Editable: user can modify file and save back to target via SFTP                 |
|R67|Files > 1MB show warning, option to view first N lines only                     |
|R68|Binary files detected (null byte check) and rejected with a message             |
|R69|Save failures (permissions, disk) handled gracefully — edits preserved in buffer|

### Theming & Appearance

|#  |Requirement                                                                                  |
|---|---------------------------------------------------------------------------------------------|
|R40|Dark mode by default, light mode toggle                                                      |
|R41|Terminal color scheme selection (preset themes: Dracula, Solarized Dark, Monokai, Nord, etc.)|
|R42|Configurable terminal font family and size                                                   |
|R43|Theme persisted in browser localStorage (per-user, not per-project)                          |
|R44|Terminal theme applies per-session or globally (user choice)                                 |

### Notifications

|#  |Requirement                                                                                                                   |
|---|------------------------------------------------------------------------------------------------------------------------------|
|R45|Browser notification when session status changes (connected → reconnecting → unreachable → recovered)                         |
|R46|Bell character detection: when target sends \a (BEL), trigger browser notification with session name                          |
|R47|Command completion alert: detect prompt return after long-running command (> configurable threshold, default 30s), notify user|
|R48|Notification permission requested on first use, settings to toggle per notification type                                      |
|R49|Visual badge on tab when activity occurs in a background session                                                              |

### Snippets

|#  |Requirement                                                                                         |
|---|----------------------------------------------------------------------------------------------------|
|R50|Saved command snippets per project                                                                  |
|R51|Snippet has: name, command string, optional description                                             |
|R52|Snippets accessible via dropdown/palette in the session tab                                         |
|R53|Clicking a snippet sends the command to the active terminal (with Enter)                            |
|R54|Snippet management UI: add, edit, delete, reorder                                                   |
|R55|Support parameterized snippets with `{{placeholder}}` syntax — prompt user for values before sending|

-----

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (any device on tailnet)                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────┐            │
│  │  Project: "QIS Staging"                         │            │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐        │            │
│  │  │ Tab: API │ │ Tab: DB  │ │Tab:Worker│        │            │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘        │            │
│  └───────┼─────────────┼────────────┼──────────────┘            │
│          └─────────────┼────────────┘                            │
│                        │  WebSocket per session                  │
└────────────────────────┼────────────────────────────────────────┘
                         │  Tailscale (WireGuard encrypted)
          ┌──────────────┴──────────────────────────────────┐
          │  Fastify Server (VPS, port 3000)                 │
          │  Serves React app + API + WebSocket              │
          │                                                  │
          │  ProjectManager                                  │
          │  ├── projects & session definitions (SQLite)     │
          │  └── autostart on boot                           │
          │                                                  │
          │  SessionManager                                  │
          │  ├── active sessions (in-memory + SQLite)        │
          │  ├── SSH connections (ssh2)                       │
          │  ├── transparent tmux lifecycle                   │
          │  └── auto-recovery with backoff                  │
          │                                                  │
          │  SftpBridge                                      │
          │  └── file ops over existing SSH connections       │
          │                                                  │
          │  SQLite: projects, project_sessions,              │
          │          active_sessions, snippets, settings      │
          └────────┬──────────┬──────────┬──────────────────┘
                   │          │          │
              SSH  │     SSH  │     SSH  │
                   │          │          │
            ┌──────┴┐  ┌─────┴──┐ ┌─────┴──┐
            │API srv│  │ DB srv │ │Worker  │
            │ tmux  │  │  tmux  │ │ tmux   │   ← tmux hidden
            └───────┘  └────────┘ └────────┘
```

### Components

#### 1. Browser Client (React + xterm.js)

**Responsibilities:**

- Project home screen: list projects with status badges
- Tab workspace per project with xterm.js terminals
- WebSocket per session, auto-reconnect with exponential backoff
- Send session ID on reconnect so the server can reattach
- Virtual key bar for mobile (Ctrl, Esc, Tab, arrows, common combos)
- Slide-out SFTP file browser per session
- Drag-and-drop upload, click-to-download

**Key behavior on reconnect:**

1. Browser opens (fresh visit or reconnect after disconnect)
1. Client fetches `GET /api/projects` → gets all projects with active session status
1. Projects with active sessions auto-expand into tab workspace
1. For each active session, opens WebSocket with `?sessionId=xxx`
1. Server pipes existing tmux output → terminal is restored

**xterm.js addons:**

- `xterm-addon-fit` — responsive resize
- `xterm-addon-web-links` — clickable URLs
- `xterm-addon-search` — find in buffer (Ctrl+Shift+F)

#### 2. Fastify Server (Node.js)

**REST API:**

```
# Projects
GET    /api/projects                    → list all projects with active session counts
POST   /api/projects                    → create project
PUT    /api/projects/:id                → update project (name, autostart, TTL)
DELETE /api/projects/:id                → delete project (kills active sessions)

# Project session definitions
GET    /api/projects/:id/sessions       → list session definitions for project
POST   /api/projects/:id/sessions       → add session definition
PUT    /api/projects/:pid/sessions/:sid → update session definition
DELETE /api/projects/:pid/sessions/:sid → remove session definition

# Active sessions
POST   /api/projects/:id/launch         → launch all sessions in project
DELETE /api/projects/:id/stop            → stop all sessions in project
GET    /api/active-sessions              → list all active sessions (across projects)
DELETE /api/active-sessions/:id          → kill single active session

# File transfer (per active session)
GET    /api/active-sessions/:id/files?path=/opt     → list directory
GET    /api/active-sessions/:id/files/download?path= → download file
POST   /api/active-sessions/:id/files/upload?path=   → upload file (multipart)

# Ad-hoc sessions
POST   /api/sessions/adhoc              → create one-off session (no project)

# Snippets (per project)
GET    /api/projects/:id/snippets       → list snippets for project
POST   /api/projects/:id/snippets       → create snippet
PUT    /api/projects/:pid/snippets/:sid → update snippet
DELETE /api/projects/:pid/snippets/:sid → delete snippet
POST   /api/active-sessions/:id/execute → send snippet command to active session

# Settings
GET    /api/settings                    → get all settings (theme, font, notifications)
PUT    /api/settings                    → update settings

# Session log & search
GET    /api/active-sessions/:id/log?lines=10000  → dump session output as text file
GET    /api/projects/:id/search?q=error+timeout  → search across all project sessions
```

**WebSocket endpoint:**

```
WS /ws/terminal?sessionId=xxx
```

- If `sessionId` exists and active → reattach to existing SSH/tmux channel
- Stream is bidirectional: browser keystrokes → SSH, SSH output → browser

#### 3. SessionManager

Core service managing active session lifecycle. Handles both remote (SSH) and local sessions through a unified interface.

```
SessionManager
├── sessions: Map<sessionId, ActiveSessionState>
│   └── ActiveSessionState {
│         id: string
│         projectId: string | null
│         projectSessionId: string | null
│         connectionType: 'ssh' | 'local'
│         host: string                         // 'localhost' for local sessions
│         username: string
│         tmuxSessionName: string              // "wt_<sessionId>"
│         sshConnection: ssh2.Client | null    // null for local sessions
│         sshChannel: ssh2.Channel | null      // null for local sessions
│         localProcess: ChildProcess | null    // null for SSH sessions
│         activeWebSocket: WebSocket | null
│         status: 'connected' | 'detached' | 'reconnecting' | 'unreachable'
│         reconnectAttempts: number
│         createdAt: Date
│         lastActivity: Date
│         displayName: string
│       }
│
├── launchProject(projectId)           // launch all sessions (SSH or local)
├── stopProject(projectId)             // kill all active sessions in project
├── attach(sessionId, ws)              // pipe WS ↔ SSH channel or local process
├── detach(sessionId)                  // disconnect WS, backend stays alive
├── create(config) → sessionId         // SSH or local + tmux new + auto-commands
├── kill(sessionId)                    // tmux kill + SSH close / process kill
├── recover()                          // on proxy boot: reconnect from SQLite
│                                      // parallel with concurrency limit (5)
├── autoReconnect(sessionId)           // retry loop on SSH failure
├── runAutoCommands(channel, cmds)     // fire-and-forget startup commands
├── dumpLog(sessionId, lines) → text   // tmux capture-pane → return text
└── searchOutput(projectId, query)     // search across all session logs
```

#### 4. Transparent Tmux Layer

The server manages tmux on each target without user awareness.

**On session create:**

```bash
# Size comes from browser terminal dimensions (sent before session creation)
tmux new-session -d -s wt_abc123 -x ${cols} -y ${rows}
```

Then runs auto-commands inside the tmux session and attaches the SSH channel.

**Important:** The client must send its terminal dimensions *before* the server creates the tmux session. Flow: WS connects → client sends `{ type: 'resize', cols, rows }` → server creates tmux with those dimensions → streaming begins.

**On browser reconnect (tmux still alive):**

```bash
tmux attach-session -t wt_abc123
```

Scroll-back is preserved by tmux.

**On target reboot recovery (tmux gone):**

```bash
tmux new-session -d -s wt_abc123 -x 200 -y 50
# then run auto-commands from project session definition
```

**On session kill:**

```bash
tmux kill-session -t wt_abc123
```

**On terminal resize:**

```bash
tmux resize-window -t wt_abc123 -x {cols} -y {rows}
```

**Naming convention:** `wt_<sessionId>` — avoids collision with user's own tmux sessions.

#### 4b. Local Sessions

When `auth_type` is `local`, the proxy skips SSH entirely and manages tmux directly on its own machine.

**Create:**

```bash
# No SSH — direct tmux spawn
tmux new-session -d -s wt_abc123 -x ${cols} -y ${rows}
```

Then runs auto-commands and attaches via `child_process.spawn('tmux', ['attach-session', '-t', 'wt_abc123'])`, piping stdin/stdout to the WebSocket.

**File operations:** SFTP replaced by direct `fs` calls:

- File browser: `fs.readdir()` instead of `sftp.readdir()`
- File read/write: `fs.readFile()` / `fs.writeFile()` instead of SFTP streams
- Upload/download: same API endpoints, different backend implementation

**Recovery on proxy restart:** Simpler than SSH — tmux sessions survive because they're local. Just `tmux has-session -t wt_xxx` and reattach. No SSH reconnection needed.

**The abstraction:** `SshBridge` and a new `LocalBridge` both implement the same interface:

```
SessionBridge {
  connect(config) → channel (readable/writable stream)
  exec(command) → output
  readFile(path) → content
  writeFile(path, content)
  listDir(path) → entries
  resize(cols, rows)
  close()
}
```

SessionManager doesn't care which bridge it's talking to. Same API, same lifecycle, same UI.

#### 5. Auto-Recovery

When a target server reboots or SSH drops:

```
1. Health check detects SSH dead (keepalive timeout)
2. Session status → 'reconnecting' (UI shows spinner)
3. Retry loop:
   - Attempt SSH every 5s
   - Backoff: 5s → 10s → 20s → 40s → 60s (cap)
   - Max retries: configurable (default 60 ≈ ~30 min)
4. SSH connects →
   a. tmux has-session -t wt_xxx?
   b. Yes → attach (network blip, tmux survived)
   c. No → new tmux session + run auto-commands (target rebooted)
5. Session status → 'connected', WebSocket resumes
6. Max retries exceeded → status → 'unreachable' (manual retry available)
```

**Auto-commands** execute inside the tmux session after every fresh tmux creation:

- On first connect
- On recovery after target reboot
- On proxy boot recovery (autostart projects)

Commands are sent sequentially with ~100ms delay, fire-and-forget.

#### 6. SSH Agent Forwarding

The proxy's local SSH agent is forwarded to target servers, enabling git operations and SSH-based workflows without copying keys to every target.

**How it works:**

- The VPS runs `ssh-agent` with the relevant keys loaded (or uses a key file)
- `ssh2` client connects with `agentForward: true`
- The SSH connection sets up agent forwarding so that `ssh`, `git`, `scp` on the target use the proxy's agent
- This means `git pull` on a target server "just works" using the VPS's SSH keys

**Configuration:** Agent forwarding is enabled by default for all sessions. Can be disabled per session definition if needed (add `agent_forward` boolean to `project_sessions`).

**Prerequisite:** The VPS must have `ssh-agent` running with keys loaded, or the key files must be accessible. Typically handled in the VPS setup:

```bash
eval $(ssh-agent)
ssh-add ~/.ssh/id_ed25519
```

#### 7. Session Log & Global Search

**Session log dump:**

- Endpoint: `GET /api/active-sessions/:id/log?lines=10000`
- Server executes: `tmux capture-pane -t wt_xxx -p -S -10000`
- Returns plain text, served as downloadable file with `Content-Disposition: attachment`
- UI: "Export log" button per session tab

**Global search across project sessions:**

- Endpoint: `GET /api/projects/:id/search?q=error+timeout`
- Server iterates all active sessions in the project:
  - For each: `tmux capture-pane -t wt_xxx -p -S -10000`
  - Grep for the query string
  - Return matches with session name, line number, surrounding context
- UI: search bar in the project workspace header, results shown as a list grouped by session, click to jump to that session

**Performance note:** `tmux capture-pane` is fast (in-memory buffer). Searching 5 sessions × 10,000 lines is trivial. No indexing needed.

#### 8. File Transfer (SFTP)

Piggybacks on existing SSH connections — no extra ports needed.

- `ssh2.SFTPStream` handles all operations
- Upload: browser multipart POST → Fastify streams to `sftp.createWriteStream(remotePath)`
- Download: `sftp.createReadStream(remotePath)` → Fastify pipes to HTTP response
- Directory listing: `sftp.readdir(path)` → JSON (name, size, permissions, modified)
- SFTP session opened per-request, closed after (lightweight, avoids stale handles)

**UI:** Slide-out panel per session, directory browser with breadcrumbs, drag-and-drop upload, click-to-download, progress bar.

#### 8b. Inline File Editor

Turns file paths in terminal output into clickable links that open an editor panel.

**Path detection:**

- Custom xterm.js link provider with regex matching:
  - Absolute paths: `/var/log/nginx/error.log`
  - Stack trace paths: `src/handlers/auth.ts:47:12`, `File "/opt/api/app.py", line 23`
  - Relative paths resolved against last known `pwd` (tracked via prompt detection)
- Patterns are configurable but ship with sensible defaults for Node.js, Python, Go, Rust stack traces

**File open flow:**

```
1. User clicks detected path in terminal
2. Client sends: GET /api/active-sessions/:id/files/view?path=/opt/api/src/auth.ts
3. Server:
   a. SFTP stat → check size (reject > 1MB) and detect binary (read first 8KB)
   b. SFTP read → return file content + metadata (size, permissions, modified)
4. Client opens side panel with Monaco Editor / CodeMirror
5. Syntax highlighting from file extension mapping
6. If line number in path (auth.ts:47) → scroll to line, highlight it
```

**Save flow:**

```
1. User edits file, clicks Save (or Ctrl+S)
2. Client sends: PUT /api/active-sessions/:id/files/write?path=/opt/api/src/auth.ts
   Body: file content
3. Server: SFTP write → respond with success or error
4. On failure: error shown in editor, edits preserved in buffer
5. On success: "Saved" indicator, editor stays open
```

**API endpoints:**

```
GET /api/active-sessions/:id/files/view?path=   → read file content (text, with metadata)
PUT /api/active-sessions/:id/files/write?path=  → write file content back
```

**Editor library:** Monaco Editor (heavier, full VS Code experience) or CodeMirror 6 (lighter, faster load). Recommendation: **CodeMirror 6** — it's 1/10th the bundle size of Monaco, supports all needed features, and loads fast on mobile. Monaco can be swapped in later if needed.

#### 9. Notifications

Notifications are browser-side, driven by events from the WebSocket stream and session state changes.

**Session status notifications:**

- Server sends status change events over a dedicated WebSocket channel (`WS /ws/events`)
- Client shows browser notification: "QIS Staging / API: reconnecting…" or "…recovered"
- Visual badge on inactive tabs when status changes

**Bell character detection:**

- xterm.js emits a `bell` event when the terminal receives `\a` (BEL)
- Client triggers browser notification: "QIS Staging / DB: bell"
- Common use case: `make build && echo -e '\a'` — you get notified when build finishes

**Long-running command detection:**

- Client tracks time since last prompt line (heuristic: line matching a configurable prompt regex)
- If no prompt detected for > threshold (default 30s), and then a prompt returns → notify
- "QIS Staging / API: command completed (took 2m 14s)"
- This is best-effort — prompt detection via regex is imperfect but good enough for most shells

**Activity badge:**

- When output arrives on a session that isn't the active tab → show dot/badge on that tab
- Clears when user switches to that tab

**Event WebSocket:**

```
WS /ws/events
→ server pushes: { type: 'status_change', sessionId, oldStatus, newStatus }
→ server pushes: { type: 'session_created', sessionId, projectId }
→ server pushes: { type: 'session_killed', sessionId }
```

#### 10. Snippets

Reusable commands scoped to a project.

**Data model:**

```
Snippet {
  id: string
  projectId: string
  name: string            // "Restart API"
  command: string         // "sudo systemctl restart {{service}}"
  description?: string    // "Restarts the given systemd service"
  sortOrder: number
}
```

**Parameterized snippets:**

- Commands can include `{{placeholder}}` tokens
- When user clicks a parameterized snippet, a modal prompts for each placeholder value
- Values are substituted, then the full command is sent to the active session
- Example: `docker logs --tail {{lines}} {{container}}` → prompts for "lines" and "container"

**Execution:**

- Clicking a snippet sends the resolved command string over the active WebSocket as keystrokes + Enter
- Same as if the user typed it — output appears in the terminal naturally
- The `POST /api/active-sessions/:id/execute` endpoint is an alternative for programmatic use

**UI:**

- Snippet palette accessible via button in the tab bar or keyboard shortcut (Ctrl+Shift+P / Cmd+Shift+P)
- Filterable list, sorted by sortOrder
- Edit/manage via project settings

#### 11. Theming & Appearance

**Terminal theming:**

- xterm.js accepts a `theme` object (foreground, background, cursor, ANSI color palette)
- Preset themes bundled: Dracula, Solarized Dark, Monokai, Nord, One Dark, Gruvbox
- User selects globally; can override per-project if desired

**App theming:**

- Dark mode by default, light mode toggle
- CSS custom properties driven by the active theme
- Follows the terminal color scheme for visual consistency

**Font:**

- Configurable font family (monospace options: JetBrains Mono, Fira Code, Source Code Pro, Cascadia Code, system monospace)
- Configurable font size (12-20px range)

**Persistence:**

- Settings stored server-side in `settings` table → syncs across devices
- Applied on client load via `GET /api/settings`

#### 12. Proxy Boot Sequence

```
1. Fastify starts
2. Read all projects from SQLite
3. Read all active_sessions from SQLite (leftover from previous run)
4. Recover active sessions in parallel (max 5 concurrent SSH connections):
   a. Re-establish SSH to target (with agent forwarding)
   b. tmux has-session? → attach or create new + auto-commands
   c. If SSH fails → enter autoReconnect loop
5. For each autostart project with NO active sessions:
   a. Launch all project sessions in parallel (same concurrency limit)
6. Server ready — accepting WebSocket connections

Note: Steps 4 and 5 use a shared semaphore (concurrency=5) to avoid
overwhelming the VPS or target servers with simultaneous SSH handshakes.
```

#### 13. SQLite Storage

```sql
CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    autostart   BOOLEAN DEFAULT 0,
    idle_ttl    INTEGER DEFAULT 0,       -- 0 = no timeout (minutes)
    tab_order   INTEGER DEFAULT 0,       -- project ordering on home screen
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE project_sessions (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,           -- "API", "DB", "Worker"
    host            TEXT NOT NULL,
    port            INTEGER DEFAULT 22,
    username        TEXT NOT NULL,
    auth_type       TEXT NOT NULL,           -- 'key' | 'password' | 'local'
    key_path        TEXT,                    -- path on VPS filesystem (SSH only)
    auto_commands   TEXT,                    -- JSON array
    agent_forward   BOOLEAN DEFAULT 1,       -- SSH agent forwarding (default on)
    tab_order       INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE active_sessions (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT REFERENCES projects(id),
    project_session_id      TEXT REFERENCES project_sessions(id),
    host                    TEXT NOT NULL,
    username                TEXT NOT NULL,
    tmux_name               TEXT NOT NULL,           -- "wt_<id>"
    display_name            TEXT,
    status                  TEXT DEFAULT 'connected',
    reconnect_attempts      INTEGER DEFAULT 0,
    max_reconnect_attempts  INTEGER DEFAULT 60,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE snippets (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,           -- "Restart API"
    command         TEXT NOT NULL,           -- "sudo systemctl restart api"
    description     TEXT,                    -- optional context
    sort_order      INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
    key             TEXT PRIMARY KEY,        -- "theme", "font_family", "font_size", etc.
    value           TEXT NOT NULL             -- JSON-encoded value
);
```

**Note on theming:** Global appearance settings (dark/light mode, font) are stored server-side in the `settings` table so they sync across devices. Terminal color scheme can also be stored here, or overridden per-project via a `theme` column on `projects` if per-project theming is desired later.

#### 14. Network Access (Tailscale)

No reverse proxy, no auth layer, no HTTPS certificates. Tailscale handles all of it.

**Two Tailscale roles:**

1. **Browser → Proxy:** Tailscale encrypts the HTTP/WebSocket connection. No HTTPS needed.
1. **Proxy → Targets:** Regular SSH (`ssh2` library) over the Tailscale network. SSH keys on VPS, standard `sshd` on targets. Tailscale is just the encrypted transport.

```bash
# VPS (proxy) setup:
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
# Generate SSH key once:
ssh-keygen -t ed25519 -f ~/.ssh/web-terminal
# Add public key to each target's authorized_keys

# Target server setup:
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
# Lock down SSH to Tailscale only:
# /etc/ssh/sshd_config → ListenAddress 100.x.y.z

# Access from any device on tailnet:
# http://web-terminal:3000   (MagicDNS)
# http://100.x.y.z:3000     (Tailscale IP)
```

**Session configs use MagicDNS hostnames:**

```
host: qis-api          ← not an IP, just the Tailscale machine name
host: qis-db
host: sterk-prod-web
```

**Why this works:**

- Tailscale = WireGuard mesh VPN. All traffic encrypted end-to-end.
- Only devices on your tailnet can reach any port. No firewall rules needed.
- Target servers can disable public SSH entirely — `ListenAddress` bound to Tailscale IP only.
- Works from phone (Tailscale mobile app), laptop, any device.
- MagicDNS gives memorable hostnames instead of IPs.
- No certificates to manage, no domain to buy.
- Regular SSH over Tailscale preserves full `ssh2` functionality: SFTP, agent forwarding, channel multiplexing.

-----

## Failure Modes & Recovery

|Failure                  |What happens                                                |Recovery                                                                                                                  |
|-------------------------|------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
|**Browser tab closed**   |WS disconnects. SSH + tmux alive.                           |Reopen browser → projects with active sessions shown → click to reattach                                                  |
|**Internet drops**       |WS drops. SSH + tmux alive.                                 |Auto-reconnect WS with backoff. Sessions resume.                                                                          |
|**Switch device**        |No WS connected. SSH + tmux alive.                          |Open browser on new device → same project state → attach                                                                  |
|**VPS proxy restarts**   |In-memory sessions lost. SSH dropped. Tmux on targets alive.|Boot sequence: restore from SQLite → re-SSH → reattach tmux or recreate + auto-commands. Autostart projects also launched.|
|**Target server reboots**|Tmux gone. SSH dead.                                        |Auto-recovery: retry SSH with backoff → new tmux → auto-commands → session resumes.                                       |
|**SSH network blip**     |Channel dead. Tmux on target alive.                         |Re-establish SSH → attach existing tmux → transparent to user.                                                            |
|**Target down > 30 min** |Max retries exceeded.                                       |Status → 'unreachable'. Manual retry button in UI.                                                                        |

-----

## Tech Stack

|Component         |Technology                                 |
|------------------|-------------------------------------------|
|Terminal rendering|xterm.js                                   |
|File editor       |CodeMirror 6                               |
|Browser UI        |React + Vite                               |
|WebSocket + API   |Fastify + @fastify/websocket               |
|SSH client        |ssh2 (Node.js)                             |
|Persistence       |better-sqlite3                             |
|Network access    |Tailscale (no reverse proxy, no auth layer)|
|Target persistence|tmux (transparent)                         |

-----

## Project Structure

```
web-terminal/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ProjectHome.tsx         # project list with status
│   │   │   ├── ProjectWorkspace.tsx    # tab container for a project
│   │   │   ├── Terminal.tsx            # xterm.js wrapper
│   │   │   ├── TabBar.tsx             # session tabs + quick-connect "+" input
│   │   │   ├── VirtualKeyBar.tsx      # mobile modifier keys
│   │   │   ├── SelectModeToggle.tsx   # mobile: switch terminal to text selection
│   │   │   ├── StatusIndicator.tsx    # connection state badge
│   │   │   ├── ProjectForm.tsx        # create/edit project + sessions
│   │   │   ├── FileBrowser.tsx        # slide-out SFTP file browser
│   │   │   ├── FileEditor.tsx        # CodeMirror side panel editor
│   │   │   ├── TransferProgress.tsx   # upload/download progress
│   │   │   ├── SnippetPalette.tsx     # Ctrl+Shift+P command palette
│   │   │   ├── SnippetParamModal.tsx  # placeholder input modal
│   │   │   ├── GlobalSearch.tsx       # search across project sessions
│   │   │   ├── ThemeSelector.tsx      # terminal + app theme picker
│   │   │   ├── SettingsPanel.tsx      # global settings (font, theme, notifications)
│   │   │   └── NotificationBadge.tsx  # tab activity indicator
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts        # reconnectable WS with backoff
│   │   │   ├── useProjects.ts         # project + session CRUD
│   │   │   ├── useFileTransfer.ts     # upload/download with progress
│   │   │   ├── useNotifications.ts    # browser notifications + permission
│   │   │   ├── useSnippets.ts         # snippet CRUD + execution
│   │   │   ├── useSettings.ts         # theme + font + notification prefs
│   │   │   ├── useSearch.ts           # global search across sessions
│   │   │   └── useEventStream.ts      # WS /ws/events listener
│   │   ├── themes/
│   │   │   └── terminal-themes.ts     # xterm.js theme presets
│   │   └── App.tsx
│   └── vite.config.ts
│
├── server/
│   ├── index.ts                       # Fastify bootstrap + boot sequence
│   ├── routes/
│   │   ├── projects.ts                # project CRUD + launch/stop
│   │   ├── sessions.ts                # active session management
│   │   ├── terminal.ts                # WebSocket handler
│   │   ├── events.ts                  # WS /ws/events push channel
│   │   ├── files.ts                   # SFTP endpoints
│   │   ├── snippets.ts               # snippet CRUD + execute
│   │   ├── search.ts                 # global search + session log dump
│   │   └── settings.ts               # global settings CRUD
│   ├── services/
│   │   ├── SessionManager.ts          # core session lifecycle
│   │   ├── ProjectManager.ts          # project operations + autostart
│   │   ├── SessionBridge.ts           # interface for SSH and local bridges
│   │   ├── SshBridge.ts               # ssh2 + tmux commands (remote)
│   │   ├── LocalBridge.ts             # child_process + tmux + fs (local)
│   │   ├── SftpBridge.ts              # SFTP operations (remote files)
│   │   ├── AutoRecovery.ts            # reconnect loop + auto-commands
│   │   ├── EventBus.ts               # internal event emitter → WS push
│   │   └── HealthChecker.ts           # periodic connection validation
│   ├── db/
│   │   ├── schema.sql
│   │   └── database.ts               # better-sqlite3 wrapper
│   └── types.ts
│
├── docker-compose.yml
└── README.md
```

-----

## Resolved Decisions

|Question              |Decision                                                                                                                                                   |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
|Multi-attach          |No. One browser ↔ one session. Opening a second device steals the WebSocket from the first — single-user tool, intentional behavior.                       |
|File transfer         |Yes. SFTP over existing SSH. Slide-out file browser.                                                                                                       |
|Session sharing       |No. Single-user tool.                                                                                                                                      |
|Audit logging         |No. (But session log dump available on demand.)                                                                                                            |
|Target reboot recovery|Auto-reconnect with backoff + auto-commands.                                                                                                               |
|Session persistence   |Sessions persist until killed. "Remember open" is default behavior.                                                                                        |
|Autostart             |Per-project flag. Launches on proxy boot.                                                                                                                  |
|Theming               |Dark mode default, light toggle. Preset terminal themes. Configurable font. Server-side persistence.                                                       |
|Notifications         |Browser notifications for status changes, bell, long-running command completion. Activity badges on tabs.                                                  |
|Snippets              |Per-project, parameterized with `{{placeholder}}`, command palette UI.                                                                                     |
|Max upload size       |500MB default, configurable.                                                                                                                               |
|Tab ordering          |Drag-to-reorder, persisted per project.                                                                                                                    |
|SSH agent forwarding  |On by default, configurable per session definition.                                                                                                        |
|Global search         |Search across all sessions in a project via tmux capture-pane.                                                                                             |
|Mobile copy-paste     |Select mode toggle switches terminal from input to text selection.                                                                                         |
|Session log dump      |Export last N lines via tmux capture-pane. One button.                                                                                                     |
|Quick-connect         |"+" in tab bar, type `user@host`, instant ad-hoc session.                                                                                                  |
|Boot recovery         |Parallel with concurrency limit of 5.                                                                                                                      |
|Inline file editor    |Clickable file paths in terminal → CodeMirror side panel, editable, SFTP save. Files > 1MB rejected, binary detected.                                      |
|Auth                  |None. Tailscale-only access.                                                                                                                               |
|SSH transport         |Regular SSH (`ssh2` library) over Tailscale network. Not Tailscale SSH. Keys on VPS, `sshd` on targets. Preserves SFTP, agent forwarding, full feature set.|
|Local sessions        |`auth_type: 'local'` skips SSH, spawns tmux directly. File ops use `fs` instead of SFTP. Same UI, same lifecycle, via `SessionBridge` abstraction.         |

## Open Questions

1. **Prompt detection regex:** The long-running command notification relies on detecting when the shell prompt returns. Default regex like `[$#>] $` works for most shells. Should this be configurable per session definition?
1. **Global snippets:** Should there be shared snippets across all projects in addition to per-project ones? (e.g., `htop`, `df -h`, `docker ps`)

## v2 Roadmap

Features explicitly deferred to keep v1 focused. Architecture should not make these hard to add.

|Feature                    |Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Scheduled jobs**         |Project-level resource (like snippets and session definitions). Two modes: **(1) In-session** — send command to an already-running session on a cron schedule, output visible in scrollback. **(2) Headless** — proxy launches a session using a project's session definition, runs script, captures exit code, optionally kills session after. Enables cron-as-a-service (e.g., nightly backups) and time-aware startup (e.g., spin up dev environment at 8:50am weekdays). Jobs reference a specific project session definition for connection config + auto-commands. Skip with UI warning if target unreachable, notify on completion/failure.|
|**Split panes**            |Browser-side CSS grid splits, not tmux panes. Two xterm.js instances side by side within one project workspace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|**Broadcast mode**         |Type once, send to all sessions in a project. Toggle on/off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
|**Session bookmarks**      |Save current `pwd` as a quick-navigate shortcut per session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
|**Connection health stats**|Latency, uptime %, reconnect count, last disconnect time per session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
