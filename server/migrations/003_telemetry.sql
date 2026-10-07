CREATE TABLE page_sessions (
 page_id TEXT PRIMARY KEY,
 guest_id TEXT NOT NULL REFERENCES guests(id),
 visit_id TEXT NOT NULL REFERENCES visits(id),
 kind TEXT NOT NULL CHECK(kind IN ('portal','game')),
 game_id TEXT,
 entered_at INTEGER NOT NULL,
 last_seq INTEGER NOT NULL DEFAULT 0,
 last_end_at INTEGER,
 CHECK((kind='portal' AND game_id IS NULL) OR (kind='game' AND game_id IS NOT NULL))
);
CREATE INDEX page_sessions_guest ON page_sessions(guest_id,entered_at);
INSERT INTO page_sessions(page_id,guest_id,visit_id,kind,game_id,entered_at)
 SELECT page_id,guest_id,visit_id,'game',game_id,entered_at FROM game_pages;

CREATE TABLE heartbeats (
 page_id TEXT NOT NULL REFERENCES page_sessions(page_id),
 seq INTEGER NOT NULL,
 guest_id TEXT NOT NULL REFERENCES guests(id),
 visit_id TEXT NOT NULL REFERENCES visits(id),
 client_start_at INTEGER NOT NULL,
 client_end_at INTEGER NOT NULL,
 start_at INTEGER NOT NULL,
 end_at INTEGER NOT NULL,
 playing INTEGER NOT NULL CHECK(playing IN (0,1)),
 received_at INTEGER NOT NULL,
 PRIMARY KEY(page_id,seq)
);
CREATE INDEX heartbeats_guest_time ON heartbeats(guest_id,start_at);
CREATE INDEX heartbeats_received ON heartbeats(received_at);
