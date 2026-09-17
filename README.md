# tty

A self-hosted web terminal. Open a browser on your phone or laptop and get a full terminal — with persistent sessions that survive disconnects, organized into projects with multiple named tabs.

![Screenshot](docs/screenshot.png)

---

## Why tty

Most web terminals expose a single shell and call it done. tty is built around the workflow of running long-lived processes — AI agents, builds, log tails — and checking in on them from wherever you are.

- **Sessions persist** — tmux keeps everything running when you close the tab or lose your connection. Come back and pick up where you left off.
- **Organized workspaces** — group sessions into projects (e.g. a "homelab" project with tabs for "claude", "logs", "docker"). Activity indicators show which tabs have new output without you having to click through them.
- **Grid mode** — on desktop, view all sessions at once in a resizable grid. Drag dividers to resize, click to focus, maximize button to go full-screen.
- **Works on mobile** — touch scrolling, momentum, readable on small screens.
- **File browser** — upload and download files without needing scp or sftp.
- **No cloud, no telemetry** — runs on your own machine. Single password authentication, nothing else required.

---

## How it works

**Projects** group related terminals. Each project has one or more **sessions** — each session is a persistent tmux window that keeps running in the background. The workspace shows all sessions for the active project as tabs, with a dot indicator:

- 🟡 pulsing — session is producing output right now
- 🟠 static — output arrived while you were on another tab
- 🟢 steady — idle

Sessions are local shells or SSH connections to remote servers. They survive browser closes, network drops, and server restarts (local sessions are recovered automatically on boot).

---

## Requirements

- Node.js 18+
- tmux

---

## Quick start

```bash
git clone https://github.com/docnavy11/tty
cd tty
npm install
npm run build
node server/dist/index.js
```

Open http://localhost:3000

Create a project, add a session, open a terminal.

---

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. A non-loopback value needs `AUTH_TOKEN` (see below). |
| `DATA_DIR` | `./data` | SQLite database and persistent data |
| `CLIENT_DIST` | `./client/dist` | Built frontend assets |
| `AUTH_TOKEN` | _(unset)_ | Password to protect the app. If unset, no auth — and then only a loopback `HOST` is allowed. |
| `TTY_ALLOW_PUBLIC_NO_AUTH` | _(unset)_ | Override the refusal to bind a network address with no password. |

---

## Authentication

By default tty listens on `127.0.0.1` only, where the machine itself is the
boundary and no password is needed. The moment you bind anything else, a password
is required: with a non-loopback `HOST` and no `AUTH_TOKEN` the server prints what
to do and **exits** rather than serving an unauthenticated shell.

```bash
HOST=0.0.0.0 AUTH_TOKEN=a-long-random-value node server/dist/index.js
```

`TTY_ALLOW_PUBLIC_NO_AUTH=1` overrides the refusal. It exists for the case where
something else is the boundary — a container whose port is mapped to loopback, a
tailnet-only interface — and for nothing else.

Anyone visiting will be prompted for the password. The session is stored in a signed cookie.

**Always run behind HTTPS in production.** Without it, the password and all terminal I/O are transmitted in plaintext. See the [Reverse proxy](#reverse-proxy-and-https) section.

A single password is a thin boundary in front of a shell. Read [Security model](#security-model) for what it does and does not protect.

---

## Deploy with systemd

```bash
# Build
npm install && npm run build

# Install
sudo mkdir -p /opt/tty
sudo cp -r server/dist server/node_modules client/dist /opt/tty/
sudo cp tty.service /etc/systemd/system/tty@.service
```

Edit the service file to set your password and adjust the port if needed:

```bash
sudo nano /etc/systemd/system/tty@.service
```

Start it (replace `youruser` with the user you want sessions to run as):

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tty@youruser
```

```bash
# Useful commands
journalctl -u tty@youruser -f
sudo systemctl restart tty@youruser
```

### Updating

```bash
git pull && npm install && npm run build
sudo cp -r server/dist server/node_modules client/dist /opt/tty/
sudo systemctl restart tty@youruser
```

---

## Deploy with Docker

```bash
docker compose up -d
```

The shipped `docker-compose.yml` maps the port to `127.0.0.1` only, so `docker
compose up -d` reaches no further than the host. To open it up, set `AUTH_TOKEN`
in the `environment` section **and** change the mapping to `"3000:3000"` — in
that order.

Mounting your SSH keys lets sessions connect on to remote servers. It also hands
those keys to anyone who reaches the terminal, so the line ships commented out:

```yaml
volumes:
  - ./data:/app/data
  - ~/.ssh:/home/tty/.ssh:ro   # only with AUTH_TOKEN set
```

---

## Reverse proxy and HTTPS

Always put tty behind a reverse proxy in production. The proxy handles TLS; tty stays on localhost.

In the service file, set `HOST=127.0.0.1` so tty isn't reachable directly:

```
Environment=HOST=127.0.0.1
Environment=PORT=3000
```

### Caddy (recommended)

Caddy handles certificates and renewal automatically. Create `/etc/caddy/Caddyfile`:

```
tty.example.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

Done — Caddy provisions a Let's Encrypt certificate and handles HTTP→HTTPS redirects.

### nginx

```nginx
server {
    listen 80;
    server_name tty.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name tty.example.com;

    ssl_certificate     /etc/letsencrypt/live/tty.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tty.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Keep terminal WebSockets alive through idle periods
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Get a certificate with Certbot before enabling the `443` block:

```bash
sudo certbot certonly --nginx -d tty.example.com
sudo nginx -s reload
```

---

## Security model

tty hands whoever can reach it a shell on the host, running as the user that
started the server. Treat a tty URL the way you would treat an unlocked SSH
session: **reaching the app is the credential.** Everything below follows from
that one fact.

### Recommended deployments, best first

1. **Private network only.** Bind to a VPN/tailnet address, or to `127.0.0.1`
   behind a reverse proxy that is itself private. The network becomes the auth
   boundary and the password is a second layer rather than the only one.
2. **Internet-facing:** `AUTH_TOKEN` set to a long random value, HTTPS
   terminated by a reverse proxy, and rate limiting on `/api/auth/login` at the
   proxy. This is the minimum, not a recommendation.
3. **Never:** reachable from the internet with no `AUTH_TOKEN`. That is an
   unauthenticated remote shell. The server refuses to start in this
   configuration; `TTY_ALLOW_PUBLIC_NO_AUTH=1` forces it, and then warns on
   every boot.

### What the app enforces

- With `AUTH_TOKEN` set, every route requires a valid signed cookie — including
  the terminal WebSocket. An upgrade request to `/ws/terminal` without the
  cookie is rejected with 401 before any pty is attached.
- `/api/health` is behind the same guard, so external uptime checks will get a
  401 rather than a 200. Probe from behind the proxy, or expect that.
- The session cookie is `httpOnly`, `sameSite=strict`, signed with `AUTH_TOKEN`,
  and valid for 30 days.
- Failed logins are logged with the client IP.
- Startup warns when bound to a public address with no `AUTH_TOKEN`, when
  `AUTH_TOKEN` is under 12 characters, and when the server is running as root.

### What the app does not do

- **One shared password.** No user accounts, no MFA, no way to list or revoke
  issued cookies short of changing `AUTH_TOKEN`.
- **No login rate limiting or lockout.** Twenty wrong passwords in a row are
  answered with twenty 401s. If tty is exposed, rate limiting is your reverse
  proxy's job.
- **No audit log** of commands run inside sessions.

### Filesystem and credential exposure

- The file browser and editor reach everything the server's user can read and
  write — not just the project directories. Run tty as a dedicated
  low-privilege user, not as your main account and not as root.
- SSH passwords for remote sessions are held in memory for the life of the
  session and are never written to the database; the schema has no column for
  them. SSH **key paths** are stored, so protect `DATA_DIR` and the keys it
  points at.
- The Docker image runs as a non-root user (uid 1001).

---

## Development

```bash
npm install
npm run check      # typecheck + tests
npm test           # tests alone
npm run build      # client and server
```

The suite covers the part that has to be right: the auth guard. Every route is
refused without a valid signed cookie, the auth endpoints stay reachable so you
can log in, a forged or empty cookie does not pass, an empty password is not
mistaken for "no password configured", and the startup refusal is asserted for
each combination of bind address, token and override. CI runs all of it on
Node 22, then starts the built server with a public bind and no token to prove
it exits rather than serving.

`server/src/app.ts` builds the app without opening a database, starting a pty or
listening, so tests drive it through `app.inject()` with no ports and no tmux.
`server/src/index.ts` owns the process: database, session recovery, autostart,
the safety check and `listen`.

---

## Tech stack

- **Server**: Node.js, Fastify, node-pty, ssh2, better-sqlite3
- **Client**: React, xterm.js, Vite
- **Sessions**: tmux (local) / ssh2 shell channels (remote)

---

## License

MIT
