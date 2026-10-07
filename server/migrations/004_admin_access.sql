ALTER TABLE visits ADD COLUMN first_ip TEXT;
ALTER TABLE visits ADD COLUMN last_ip TEXT;
CREATE INDEX visits_ip_recent ON visits(last_ip,started_at DESC);

CREATE TABLE admin_account (
 id INTEGER PRIMARY KEY CHECK(id=1),
 salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE admin_sessions (
 token_hash TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);
