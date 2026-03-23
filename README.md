# tty

A self-hosted web terminal. Runs persistent tmux sessions accessible from any browser — desktop or mobile.

- Multiple sessions per project, with split-pane view
- Sessions survive browser closes and network drops
- SSH into remote servers or run local shells
- File browser with upload/download
- Mobile-friendly with touch scrolling

## Requirements

- Node.js 18+
- tmux
- (Optional) SSH access to remote servers

## Quick start

```bash
git clone https://github.com/yourname/tty
cd tty
npm run install:all
npm run build
npm start
```

Open http://localhost:3000

## Development

```bash
npm run install:all
npm run dev
```

Runs the server with hot reload and Vite dev server on http://localhost:3000.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | SQLite database and persistent data |
| `CLIENT_DIST` | `./client/dist` | Built frontend assets |
| `AUTH_TOKEN` | _(unset)_ | Password to protect the app. If unset, no auth. |

## Authentication

By default the app is open. Set `AUTH_TOKEN` to require a password:

```bash
AUTH_TOKEN=yourpassword node server/dist/index.js
```

Anyone visiting the app will be prompted for the password. The session is stored in a cookie.

**Note:** Always run behind HTTPS in production. Without it, cookies and terminal I/O are transmitted in plaintext.

## Deploy with systemd

The service file uses `tty@.service` (a systemd template) so it runs as the user you specify:

```bash
# Build
npm run install:all && npm run build

# Install files
sudo mkdir -p /opt/tty
sudo cp -r server/dist client/dist /opt/tty/
sudo cp tty.service /etc/systemd/system/tty@.service

# Edit the service file to set AUTH_TOKEN and adjust port if needed
sudo nano /etc/systemd/system/tty@.service

# Enable and start (replace 'youruser')
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
git pull && npm run install:all && npm run build
sudo systemctl restart tty@youruser
```

## Deploy with Docker

```bash
docker compose up -d
```

To set a password, add `AUTH_TOKEN=yourpassword` to the `environment` section of `docker-compose.yml`.

The `~/.ssh:/root/.ssh:ro` volume gives the container access to your SSH keys for connecting to remote servers.

## Security

- Set `AUTH_TOKEN` and run behind a reverse proxy with HTTPS (nginx, Caddy, etc.)
- The file browser exposes the home directory of the user running the server — run as a dedicated low-privilege user if needed
- SSH credentials are stored in the local SQLite database; protect `DATA_DIR`
