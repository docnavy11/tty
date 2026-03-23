# tty

A self-hosted web terminal. Runs persistent tmux sessions accessible from any browser — desktop or mobile.

- Multiple sessions per project, with split-pane view
- Sessions survive browser closes and network drops
- SSH into remote servers or run local shells
- File browser with upload/download
- Copy terminal output with search and ANSI color rendering
- Session activity indicator (idle / busy / done-unseen)
- Mobile-friendly with touch scrolling
- Optional password authentication

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
node server/dist/index.js
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
sudo cp -r server/dist server/node_modules client/dist /opt/tty/
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

## Reverse proxy and HTTPS

Always put tty behind a reverse proxy in production. The proxy handles TLS termination; tty listens on localhost only.

Set `HOST=127.0.0.1` in the service file so tty is not reachable directly from the internet:

```
Environment=HOST=127.0.0.1
Environment=PORT=3000
```

### Caddy (recommended)

Caddy obtains and renews Let's Encrypt certificates automatically. Install it, then create `/etc/caddy/Caddyfile`:

```
tty.example.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

That's it. Caddy handles HTTPS, HTTP→HTTPS redirects, and cert renewal.

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

Obtain a certificate with Certbot before enabling the `443` block:

```bash
sudo certbot certonly --nginx -d tty.example.com
sudo nginx -s reload
```

## Security

- Set `AUTH_TOKEN` and run behind HTTPS (see above)
- The file browser exposes the home directory of the user running the server — run as a dedicated low-privilege user if needed
- SSH credentials are stored in the local SQLite database; protect `DATA_DIR`
