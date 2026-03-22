# tty

A web-based terminal multiplexer. Run tmux sessions from your browser.

## Development

```bash
npm run install:all
npm run dev
```

Open http://localhost:3000

## Production build

```bash
npm run build
```

Output: `client/dist/` (static assets) and `server/dist/` (compiled server).

## Deploy with systemd

The repo includes `tty.service`. Edit it first if needed (user, paths, port).

```bash
# Install
sudo cp tty.service /etc/systemd/system/
sudo systemctl daemon-reload

# Start on boot + start now
sudo systemctl enable tty
sudo systemctl start tty
```

```bash
# Useful commands
sudo systemctl status tty
sudo systemctl restart tty
journalctl -u tty -f
```

### Updating

```bash
npm run build
sudo systemctl restart tty
```

## Configuration

Environment variables (set in `tty.service` or exported before running):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3789` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | SQLite database location |
| `CLIENT_DIST` | `./client/dist` | Built frontend assets |
