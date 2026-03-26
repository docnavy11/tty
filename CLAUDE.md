# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is TTY

A self-hosted web terminal providing persistent tmux sessions organized into projects with named tabs. Access terminal sessions from any browser/device with sessions that survive disconnects.

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
  - `LocalBridge.ts` — spawns local tmux sessions via node-pty, pipes I/O to WebSocket
  - `ProjectManager.ts` — CRUD for projects and session definitions
- **Routes**: `auth.ts`, `terminal.ts` (WebSocket endpoint), `sessions.ts`, `projects.ts`, `settings.ts`, `files.ts`
- **DB**: SQLite via better-sqlite3 with WAL mode. Schema in `db/schema.sql`. Tables: projects, project_sessions (templates), active_sessions (running instances), snippets, settings

### Client (`client/src/`)

- **Entry**: `main.tsx` → `App.tsx` (manages auth, routing between Home/Workspace/Terminal views)
- **Key components**: `Terminal.tsx` (xterm.js with WebSocket, search, mobile toolbar), `ProjectWorkspace.tsx` (tabbed session view), `ProjectHome.tsx` (project grid)
- **Hooks**: `useSettings.ts` loads terminal settings (fontSize, fontFamily, theme)
- **Themes**: `themes.ts` maps theme names to xterm.js ITheme configs

### WebSocket Protocol

Client→Server: `{"type": "input", "data": "..."}`, `{"type": "resize", "cols": N, "rows": N}`, `{"type": "ping"}`
Server→Client: binary terminal data, or JSON `{"type": "error", "message": "..."}`

### Session States

`pending` → `connecting` → `connected` ↔ `detached` (browser disconnect keeps tmux alive)

### History Capture Strategy

On reconnect, history is captured from tmux scrollback **before** resizing the pane (avoids SIGWINCH redraw artifacts), then line endings are normalized `\n` → `\r\n` for xterm.js.

## Environment Variables

- `PORT` (default: 3000), `HOST` (default: 0.0.0.0)
- `DATA_DIR` (default: ./data) — contains db.sqlite
- `CLIENT_DIST` (default: ./client/dist) — frontend build output
- `AUTH_TOKEN` (optional) — enables password authentication
