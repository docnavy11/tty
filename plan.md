# WebTerminal — Build Plan

Vertical slices. Each phase ships something usable. No phase depends on the next.

---

## Phase 1 — Skeleton

**Goal:** Repo boots. Server serves client. DB initialized.

- [ ] Init monorepo: `client/` (Vite + React + TS) and `server/` (Node + TS)
- [ ] Fastify server with static file serving for client build
- [ ] SQLite schema applied on boot (`schema.sql` via `better-sqlite3`)
- [ ] `docker-compose.yml` for local dev
- [ ] `GET /api/health` returns 200
- [ ] Client renders blank app shell, confirms API reachable

---

## Phase 2 — Core Terminal

**Goal:** Type a host/user/key into a form, get a live terminal in the browser.

**Server**
- [ ] `SshBridge.ts` — connect via `ssh2`, open shell channel, attach to tmux (`tmux new-session` or `attach-session`)
- [ ] `SessionManager.ts` — `create()`, `attach()`, `detach()`, `kill()` — in-memory only for now
- [ ] `WS /ws/terminal?sessionId=xxx` — pipe WebSocket ↔ SSH channel
- [ ] `POST /api/sessions/adhoc` — create one-off session, return sessionId
- [ ] `DELETE /api/active-sessions/:id` — kill session
- [ ] Handle terminal resize: client sends `{ type: 'resize', cols, rows }` → `tmux resize-window`
- [ ] Tmux naming: `wt_<sessionId>`

**Client**
- [ ] `Terminal.tsx` — xterm.js + `xterm-addon-fit` + `xterm-addon-web-links`
- [ ] `useWebSocket.ts` — connect, send, receive, close
- [ ] Quick-connect form: `user@host`, key path → calls `POST /api/sessions/adhoc` → opens terminal
- [ ] Send `{ type: 'resize' }` on mount and window resize
- [ ] `StatusIndicator.tsx` — connected / disconnected badge

---

## Phase 3 — Session Persistence

**Goal:** Close the browser tab, reopen it, terminal is still there.

**Server**
- [ ] Persist active sessions to SQLite on create/kill
- [ ] `SessionManager.recover()` — on boot, read `active_sessions` from SQLite, re-SSH, reattach tmux
- [ ] WS attach: if `sessionId` already has active SSH channel, pipe to it (don't recreate)
- [ ] `GET /api/active-sessions` — list all active sessions with status

**Client**
- [ ] On load: fetch `GET /api/active-sessions`, reopen WebSocket for each
- [ ] `useWebSocket.ts` — reconnect with exponential backoff (1s → 2s → 4s → 30s cap)
- [ ] Session list UI — shows open sessions, click to reattach

---

## Phase 4 — Projects

**Goal:** Named groups of session definitions. Open a project → all its sessions launch as tabs.

**Server**
- [ ] `ProjectManager.ts` — project + session definition CRUD
- [ ] Routes: `projects.ts` — full CRUD + `POST /launch`, `DELETE /stop`
- [ ] `SessionManager.launchProject(projectId)` — spawn all sessions in parallel
- [ ] `SessionManager.stopProject(projectId)` — kill all active sessions for project
- [ ] Autostart flag: on boot, launch autostart projects after recovery

**Client**
- [ ] `ProjectHome.tsx` — list projects with status badges (running N/M, not running)
- [ ] `ProjectWorkspace.tsx` — tab container scoped to a project
- [ ] `TabBar.tsx` — tabs per session + "+" quick-connect button
- [ ] `ProjectForm.tsx` — create/edit project + session definitions (host, user, key, auto-commands, tab order)
- [ ] "Open project" button → `POST /api/projects/:id/launch` → tabs open
- [ ] Tab drag-to-reorder → `PUT /api/projects/:pid/sessions/:sid` (tab_order)
- [ ] Rename sessions and projects inline

---

## Phase 5 — Auto-Recovery

**Goal:** Target server reboots or SSH drops. Proxy detects it, retries, recovers silently.

**Server**
- [ ] `HealthChecker.ts` — SSH keepalive, detect dead connections
- [ ] `AutoRecovery.ts` — retry loop: exponential backoff 5s → 60s cap, max 60 attempts
- [ ] On reconnect: `tmux has-session` → attach existing or create new + run auto-commands
- [ ] `runAutoCommands()` — send commands sequentially with ~100ms delay on fresh tmux
- [ ] Session status transitions: `connected → reconnecting → unreachable`
- [ ] Persist status to SQLite
- [ ] `EventBus.ts` — internal emitter
- [ ] `WS /ws/events` + `events.ts` route — push status change events to browser
- [ ] Boot recovery: parallel reconnect with concurrency limit of 5 (semaphore)

**Client**
- [ ] `useEventStream.ts` — subscribe to `WS /ws/events`
- [ ] Update session status in UI on `status_change` events
- [ ] "Reconnecting" spinner, "Unreachable" state with manual retry button
- [ ] `NotificationBadge.tsx` — activity dot on background tabs

---

## Phase 6 — File Transfer

**Goal:** Upload a file to a server, download one back. Slide-out file browser per session.

**Server**
- [ ] `SftpBridge.ts` — `listDir()`, `readFile()`, `writeFile()`, upload/download streams
- [ ] `GET /api/active-sessions/:id/files?path=` — directory listing
- [ ] `GET /api/active-sessions/:id/files/download?path=` — stream file to browser
- [ ] `POST /api/active-sessions/:id/files/upload?path=` — multipart upload, stream to SFTP
- [ ] Max upload size configurable (default 500MB)
- [ ] `LocalBridge.ts` — same interface using `fs` for local sessions

**Client**
- [ ] `FileBrowser.tsx` — slide-out panel, breadcrumb navigation, file list
- [ ] `TransferProgress.tsx` — upload/download progress bar
- [ ] Drag-and-drop upload onto file browser
- [ ] Click to download

---

## Phase 7 — Polish

**Goal:** Production-quality UX. Mobile-ready. Full feature set from spec.

### Inline File Editor
- [ ] `FileEditor.tsx` — CodeMirror 6 side panel, syntax highlighting by extension
- [ ] Custom xterm.js link provider — detect file paths + stack trace patterns
- [ ] `GET /api/active-sessions/:id/files/view?path=` — read file, size/binary check
- [ ] `PUT /api/active-sessions/:id/files/write?path=` — write back via SFTP
- [ ] Scroll to line number if path includes `:47`
- [ ] Binary detection (null byte check), >1MB warning

### Snippets
- [ ] SQLite `snippets` table (already in schema)
- [ ] `snippets.ts` routes — full CRUD + `POST /execute`
- [ ] `SnippetPalette.tsx` — Ctrl+Shift+P palette, filterable
- [ ] `SnippetParamModal.tsx` — `{{placeholder}}` substitution modal
- [ ] `useSnippets.ts`

### Notifications
- [ ] `useNotifications.ts` — request permission on first use
- [ ] Status change notifications via `useEventStream.ts`
- [ ] Bell character (`\a`) detection via xterm.js `bell` event
- [ ] Long-running command detection — prompt regex heuristic, configurable threshold
- [ ] Notification toggle settings per type

### Global Search & Log Dump
- [ ] `search.ts` route — `tmux capture-pane` per session, grep, return matches with context
- [ ] `GlobalSearch.tsx` — search bar in project workspace header, results grouped by session
- [ ] `GET /api/active-sessions/:id/log?lines=10000` — `Content-Disposition: attachment`
- [ ] "Export log" button per session tab
- [ ] `useSearch.ts`

### Theming & Appearance
- [ ] `terminal-themes.ts` — Dracula, Solarized Dark, Monokai, Nord, One Dark, Gruvbox
- [ ] `ThemeSelector.tsx` — terminal theme picker
- [ ] `SettingsPanel.tsx` — font family, font size, dark/light toggle
- [ ] `useSettings.ts` — load from `GET /api/settings`, persist via `PUT /api/settings`
- [ ] `settings.ts` route

### Mobile UX
- [ ] `VirtualKeyBar.tsx` — Ctrl, Esc, Tab, arrows, common combos
- [ ] `SelectModeToggle.tsx` — switch terminal between input and text selection mode
- [ ] Touch scrolling verified on iOS/Android

---

## Dev Notes

- Server TypeScript compiled with `tsc` or `tsx` for dev
- Client hot-reloads via Vite dev server, proxies `/api` and `/ws` to Fastify
- SQLite file at `./data/db.sqlite`, volume-mounted in Docker
- SSH keys on host filesystem, mounted read-only into container
