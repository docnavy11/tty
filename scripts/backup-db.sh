#!/usr/bin/env bash
# Nightly backup of the tty session database.
#
# Uses SQLite's VACUUM INTO rather than copying db.sqlite. A plain file copy is
# wrong here: this database runs in WAL mode, and recent commits live in
# db.sqlite-wal until a checkpoint folds them back in. VACUUM INTO produces a
# single consistent, fully-checkpointed file including everything committed,
# and takes only a read lock, so it is safe while the server is running.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/dev/projects/tty}"
DB_PATH="${DB_PATH:-$PROJECT_DIR/data/db.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/home/dev/backups/tty}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

# cron runs with a minimal PATH, so find node explicitly.
NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  for candidate in \
    /home/dev/.nvm/versions/node/v22.22.1/bin/node \
    "$(command -v node 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then NODE_BIN="$candidate"; break; fi
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "[backup-db] FATAL: no node binary found (set NODE_BIN)" >&2
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "[backup-db] FATAL: database not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/db-$STAMP.sqlite"

cd "$PROJECT_DIR/server"
"$NODE_BIN" -e '
const Database = require("better-sqlite3");
const [dbPath, out] = process.argv.slice(1);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
// PASSIVE: folds in what it can without ever blocking the running server.
try { db.pragma("wal_checkpoint(PASSIVE)"); } catch (e) { /* readonly or busy */ }
db.prepare("VACUUM INTO ?").run(out);
const counts = ["projects", "project_sessions", "active_sessions", "snippets"]
  .map(t => `${t}=${db.prepare(`select count(*) c from ${t}`).get().c}`)
  .join(" ");
db.close();
console.log(`[backup-db] wrote ${out} (${counts})`);
' "$DB_PATH" "$OUT"

# Verify the backup opens and passes an integrity check before pruning anything.
"$NODE_BIN" -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
const r = db.pragma("integrity_check", { simple: true });
db.close();
if (r !== "ok") { console.error(`[backup-db] FATAL: integrity_check returned ${r}`); process.exit(1); }
' "$OUT"

find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.sqlite' -mtime "+$RETAIN_DAYS" -print -delete \
  | sed 's/^/[backup-db] pruned /'

echo "[backup-db] ok — $(find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.sqlite' | wc -l) backup(s) retained"
