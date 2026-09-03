# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is TTY

A self-hosted web terminal providing persistent tmux sessions organized into projects with named tabs. Access terminal sessions from any browser/device with sessions that survive disconnects. Supports desktop grid mode showing all sessions simultaneously.

## Build & Development Commands

```bash
npm run dev              # Run client (Vite) + server (tsx watch) concurrently
npm run build            # Build both client and server for production
node server/dist/index.js  # Run production server

# Individual workspaces
npm run dev --workspace=client    # Vite dev server only (proxies to :3333)
npm run dev --workspace=server    # Server with hot-reload only
npm run build --workspace=client  # Vite build only
npm run build --workspace=server  # TypeScript compile only
```

No test suite exists in this project.

## Architecture

**Monorepo** with npm workspaces: `client/` (React + Vite) and `server/` (Fastify + Node).

### Server (`server/src/`)

- **Entry**: `index.ts` — initializes DB, recovers sessions, registers Fastify plugins and routes
- **Services**:
  - `SessionManager.ts` — core logic (~1000 lines): manages session lifecycle (local/SSH), tmux history capture, resize handling, SSH connection pooling, session recovery on boot
  - `LocalBridge.ts` — spawns local tmux sessions via node-pty, pipes I/O to WebSocket. Handles reconnection with `hadClient` flag to gate history replay, debounces resize (100ms) to prevent tmux redraw cascades
  - `ProjectManager.ts` — CRUD for projects and session definitions
- **Routes**: `auth.ts`, `terminal.ts` (WebSocket endpoint), `sessions.ts`, `projects.ts`, `settings.ts`, `files.ts`
- **DB**: SQLite via better-sqlite3 with WAL mode. Schema in `db/schema.sql`. Tables: projects, project_sessions (templates), active_sessions (running instances), snippets, settings

### Client (`client/src/`)

- **Entry**: `main.tsx` → `App.tsx` (manages auth, routing between Home/Workspace/Terminal views)
- **Terminal architecture** (Option A extraction):
  - `TerminalCore.tsx` — reusable xterm engine (`forwardRef` with imperative handle: `focus`, `send`, `getTerminal`). Owns xterm lifecycle, WebSocket, resize observer, context menu, copy modal, touch scrolling, image paste. Accepts optional `onBeforeInput` transform for input interception
  - `Terminal.tsx` — thin wrapper composing TerminalCore + header bar + mobile toolbar with sticky Ctrl. Same export API (`TerminalView`) used by App.tsx and ProjectWorkspace
  - `GridCell.tsx` — grid cell wrapper with focus border, compact header (name + activity dot + maximize/close buttons), wraps TerminalCore
- **ProjectWorkspace.tsx** — tabbed session view with split mode, plus desktop-only grid mode (>=1024px). Grid uses CSS grid with `Math.ceil(Math.sqrt(n))` columns, focus management, maximize/restore
- **Hooks**: `useSettings.ts` loads terminal settings (fontSize, fontFamily, theme)
- **Themes**: `themes.ts` maps theme names to xterm.js ITheme configs

### Mouse Tracking

tmux enables mouse tracking which causes xterm to forward all mouse events to the PTY (server roundtrips for scrolling/selection). This is blocked at the xterm parser level via `parser.registerCsiHandler` intercepting DEC private mode sequences (`\e[?1000h` etc.). Mouse wheel scrolling is also intercepted client-side for local xterm scrollback. **Do not strip escape sequences from the binary data stream** — this corrupts terminal output.

### WebSocket Protocol

Client→Server: `{"type": "input", "data": "..."}`, `{"type": "resize", "cols": N, "rows": N, "noHistory": bool}`, `{"type": "ping"}`
Server→Client: binary terminal data, or JSON `{"type": "error", "message": "..."}`

The `noHistory` flag tells the server to skip scrollback replay on WebSocket reconnect (xterm buffer is still intact).

### Session States

`pending` → `connecting` → `connected` ↔ `detached` (browser disconnect keeps tmux alive)

### History Capture & Resize Strategy

On reconnect: resize pane to client dimensions **first**, then capture tmux scrollback via `tmux capture-pane`. This ensures captured lines match the client's width. Line endings are normalized `\n` → `\r\n` for xterm.js. Resize is debounced on both client (50ms) and server (100ms) with dimension checks at both ends to prevent cascading tmux redraws in grid mode.

## Environment Variables

- `PORT` (default: 3000), `HOST` (default: 0.0.0.0)
- `DATA_DIR` (default: ./data) — contains db.sqlite
- `CLIENT_DIST` (default: ./client/dist) — frontend build output
- `AUTH_TOKEN` (optional) — enables password authentication


## Infrastructure conventions

<!-- infra-pointer:start — managed block, safe to regenerate -->

This project is covered by the infrastructure documentation in
**[docnavy11/infra](https://github.com/docnavy11/infra)** (private). Read the
relevant page before changing how this project is built, deployed or configured.
On the dev server the checkout is at `/home/dev/projects/infra`.

| Question | Document |
|---|---|
| How does deployment work here? | `README.md` — the `deploy.sh` + `infra/` + `dist/` convention |
| How do I deploy, debug a 502, or restore? | `runbooks.md` |
| Which domain does this serve, and from where? | `services.md` |
| What is this project's state and known traps? | `projects/tty.md` |
| Where does everything live? | `architecture.md` |
| What is backed up, and how do I restore it? | `backups.md` |
| Known security gaps, and where secrets live | `security.md` |
| What is still outstanding? | `TODO.md` |

### Rules

- **Deploy only with `./deploy.sh`, from the dev server.** Never edit files
  directly on prod — the next deploy runs `rsync --delete` and silently
  overwrites them.
- **Never commit secrets.** Real `.env` files stay on the server at mode 600;
  commit an `env.example` documenting the required keys instead.
- **Never pin a Traefik route to a container IP or a full container name.** Both
  change on redeploy. Use a container name for `/opt` stacks, or a
  `service: http-0-<app-uuid>@docker` reference for Coolify apps. See
  `runbooks.md`.
- **Directory names are not reliable.** `intools-ai` serves
  `beteretools.linkflow.be`; `AI-readiness` serves `ai-eu-readiness.linkflow.be`;
  `scraper` is the Video Knowledge Base. Confirm via `deploy.sh`, not the name.

### If reality does not match these docs, report it

Drift is a defect, not an inconvenience — an undocumented deviation is how a
route silently 502s for weeks, or how a token ends up in a world-readable file.

1. **Do not silently work around it.**
2. State plainly what you found and what the docs claim.
3. If the docs are wrong, fix them in the infra repo.
4. If neither is right, add it to `infra/TODO.md` rather than leaving it
   undocumented.

Check this project against the documented conventions:

```bash
/home/dev/projects/infra/check-project.sh
```

It validates version control, unpushed work, tracked secrets, the deploy
convention, and whether the live domain actually responds. Exit 0 means no
failures.

<!-- infra-pointer:end -->