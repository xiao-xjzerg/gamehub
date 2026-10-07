CREATE TABLE guests (
 id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, account_id TEXT,
 nickname TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE TABLE visits (
 id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id),
 started_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE INDEX visits_guest_recent ON visits(guest_id,last_seen DESC);
CREATE TABLE runs (
 id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id),
 visit_id TEXT NOT NULL REFERENCES visits(id), request_id TEXT NOT NULL,
 game_id TEXT NOT NULL, mode TEXT NOT NULL, rules_version TEXT NOT NULL,
 started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT, metrics TEXT,
 UNIQUE(guest_id,request_id)
);
CREATE TABLE scores (
 id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT UNIQUE NOT NULL REFERENCES runs(id),
 nickname TEXT NOT NULL, accepted_at INTEGER NOT NULL
);
CREATE INDEX runs_board ON runs(game_id,mode,rules_version,guest_id);
CREATE TABLE events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id TEXT NOT NULL REFERENCES guests(id),
 visit_id TEXT NOT NULL REFERENCES visits(id), run_id TEXT REFERENCES runs(id),
 name TEXT NOT NULL CHECK(name IN ('visit_start','run_start','run_finish','score_submit')),
 occurred_at INTEGER NOT NULL
);
