CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    autostart   BOOLEAN DEFAULT 0,
    idle_ttl    INTEGER DEFAULT 0,
    tab_order   INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_sessions (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    host            TEXT NOT NULL,
    port            INTEGER DEFAULT 22,
    username        TEXT NOT NULL,
    auth_type       TEXT NOT NULL,
    key_path        TEXT,
    auto_commands   TEXT,
    agent_forward   BOOLEAN DEFAULT 1,
    tab_order       INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS active_sessions (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT REFERENCES projects(id),
    project_session_id      TEXT REFERENCES project_sessions(id),
    host                    TEXT NOT NULL,
    port                    INTEGER DEFAULT 22,
    username                TEXT NOT NULL DEFAULT '',
    auth_type               TEXT NOT NULL DEFAULT 'key',
    key_path                TEXT,
    tmux_name               TEXT NOT NULL,
    display_name            TEXT,
    status                  TEXT DEFAULT 'connected',
    reconnect_attempts      INTEGER DEFAULT 0,
    max_reconnect_attempts  INTEGER DEFAULT 60,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS snippets (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    command         TEXT NOT NULL,
    description     TEXT,
    sort_order      INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);
