CREATE TABLE game_pages (
 page_id TEXT PRIMARY KEY,
 guest_id TEXT NOT NULL REFERENCES guests(id),
 visit_id TEXT NOT NULL REFERENCES visits(id),
 game_id TEXT NOT NULL,
 entered_at INTEGER NOT NULL
);
CREATE TABLE events_v2 (
 id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id TEXT NOT NULL REFERENCES guests(id),
 visit_id TEXT NOT NULL REFERENCES visits(id), run_id TEXT REFERENCES runs(id),
 name TEXT NOT NULL CHECK(name IN ('visit_start','game_enter','run_start','run_finish','score_submit')),
 occurred_at INTEGER NOT NULL
);
INSERT INTO events_v2(id,guest_id,visit_id,run_id,name,occurred_at)
 SELECT id,guest_id,visit_id,run_id,name,occurred_at FROM events;
DROP TABLE events;
ALTER TABLE events_v2 RENAME TO events;
