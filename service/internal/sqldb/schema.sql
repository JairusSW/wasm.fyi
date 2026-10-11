PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value BLOB NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY,
  digest BLOB NOT NULL UNIQUE CHECK(length(digest)=32),
  os TEXT NOT NULL, arch TEXT NOT NULL, cpu TEXT NOT NULL,
  cores INTEGER NOT NULL, kernel TEXT NOT NULL, memory_bytes INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS engines (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS configurations (
  id INTEGER PRIMARY KEY,
  digest BLOB NOT NULL UNIQUE CHECK(length(digest)=32),
  engine_id INTEGER NOT NULL REFERENCES engines(id),
  version TEXT NOT NULL, backend TEXT NOT NULL,
  UNIQUE(engine_id,version,backend)
);
CREATE TABLE IF NOT EXISTS workloads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  digest BLOB NOT NULL UNIQUE CHECK(length(digest)=32),
  workload_id INTEGER NOT NULL REFERENCES workloads(id),
  wasm TEXT NOT NULL,
  artifact BLOB NOT NULL CHECK(length(artifact)=32)
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  repository TEXT NOT NULL, revision TEXT NOT NULL, ref TEXT NOT NULL,
  kind TEXT NOT NULL, date_basis TEXT NOT NULL,
  UNIQUE(repository,revision,ref,kind,date_basis)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  as_of TEXT NOT NULL, as_of_ns INTEGER NOT NULL,
  qualified INTEGER NOT NULL CHECK(qualified IN(0,1)),
  UNIQUE(source_id,as_of)
);
CREATE TABLE IF NOT EXISTS displays (
  id INTEGER PRIMARY KEY,
  digest BLOB NOT NULL UNIQUE CHECK(length(digest)=32),
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS sampling_policies (
  id INTEGER PRIMARY KEY,
  digest BLOB NOT NULL UNIQUE CHECK(length(digest)=32),
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS sample_vectors (
  id INTEGER PRIMARY KEY,
  digest BLOB NOT NULL UNIQUE CHECK(length(digest)=32),
  count INTEGER NOT NULL,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY,
  digest BLOB NOT NULL UNIQUE CHECK(length(digest)=32),
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  configuration_id INTEGER NOT NULL REFERENCES configurations(id),
  source_id INTEGER REFERENCES sources(id),
  display_id INTEGER REFERENCES displays(id),
  sampling_id INTEGER REFERENCES sampling_policies(id),
  samples_id INTEGER REFERENCES sample_vectors(id),
  captured_at TEXT NOT NULL, captured_ns INTEGER NOT NULL,
  phase INTEGER NOT NULL CHECK(phase BETWEEN 0 AND 3),
  latency REAL, peak_rss REAL, code_bytes REAL,
  metric_bits BLOB NOT NULL,
  latency_status INTEGER NOT NULL, memory_status INTEGER NOT NULL,
  code_status INTEGER NOT NULL, code_kind TEXT,
  timing_samples INTEGER NOT NULL
);

-- Latest and weekly bindings share one observation, including its ordered samples.
CREATE TABLE IF NOT EXISTS latest (
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  workload_id INTEGER NOT NULL REFERENCES workloads(id),
  engine_id INTEGER NOT NULL REFERENCES engines(id),
  phase INTEGER NOT NULL,
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  snapshot_id INTEGER REFERENCES snapshots(id),
  PRIMARY KEY(platform_id,workload_id,engine_id,phase)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS history (
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  workload_id INTEGER NOT NULL REFERENCES workloads(id),
  configuration_id INTEGER NOT NULL REFERENCES configurations(id),
  phase INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  PRIMARY KEY(platform_id,as_of,workload_id,configuration_id,phase)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS history_scope ON history(platform_id,phase,as_of,configuration_id);
CREATE INDEX IF NOT EXISTS latest_engine ON latest(platform_id,engine_id,phase);
CREATE INDEX IF NOT EXISTS snapshots_order ON snapshots(qualified,as_of_ns);

-- Small browsing responses are prepared when a capture commits.
CREATE TABLE IF NOT EXISTS prepared (
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  scope TEXT NOT NULL,
  revision TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY(platform_id,scope)
) WITHOUT ROWID;

-- Reference counts make weekly aliases share one sample contribution per platform.
CREATE TABLE IF NOT EXISTS platform_totals (
 platform_id INTEGER PRIMARY KEY REFERENCES platforms(id),
 latest_rows INTEGER NOT NULL DEFAULT 0, history_rows INTEGER NOT NULL DEFAULT 0,
 latest_samples INTEGER NOT NULL DEFAULT 0, all_samples INTEGER NOT NULL DEFAULT 0,
 captured_ns INTEGER, captured_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_observations (
 platform_id INTEGER NOT NULL REFERENCES platforms(id),
 observation_id INTEGER NOT NULL REFERENCES observations(id),
 latest_refs INTEGER NOT NULL DEFAULT 0 CHECK(latest_refs>=0),
 history_refs INTEGER NOT NULL DEFAULT 0 CHECK(history_refs>=0),
 PRIMARY KEY(platform_id,observation_id)
) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS platform_summary_insert AFTER INSERT ON platforms BEGIN
 INSERT INTO platform_totals(platform_id) VALUES(NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS observation_refs_insert AFTER INSERT ON platform_observations BEGIN
 UPDATE platform_totals SET
 latest_samples=latest_samples+(NEW.latest_refs>0)*(SELECT timing_samples FROM observations WHERE id=NEW.observation_id),
 all_samples=all_samples+((NEW.latest_refs+NEW.history_refs)>0)*(SELECT timing_samples FROM observations WHERE id=NEW.observation_id)
 WHERE platform_id=NEW.platform_id;
 UPDATE platform_totals SET captured_ns=(SELECT captured_ns FROM observations WHERE id=NEW.observation_id),captured_at=(SELECT captured_at FROM observations WHERE id=NEW.observation_id)
 WHERE platform_id=NEW.platform_id AND ((NEW.latest_refs+NEW.history_refs)>0) AND (captured_ns IS NULL OR captured_ns<(SELECT captured_ns FROM observations WHERE id=NEW.observation_id));
END;
CREATE TRIGGER IF NOT EXISTS observation_refs_update AFTER UPDATE ON platform_observations BEGIN
 UPDATE platform_totals SET
 latest_samples=latest_samples+((NEW.latest_refs>0)-(OLD.latest_refs>0))*(SELECT timing_samples FROM observations WHERE id=NEW.observation_id),
 all_samples=all_samples+(((NEW.latest_refs+NEW.history_refs)>0)-((OLD.latest_refs+OLD.history_refs)>0))*(SELECT timing_samples FROM observations WHERE id=NEW.observation_id)
 WHERE platform_id=NEW.platform_id;
 UPDATE platform_totals SET captured_ns=(SELECT captured_ns FROM observations WHERE id=NEW.observation_id),captured_at=(SELECT captured_at FROM observations WHERE id=NEW.observation_id)
 WHERE platform_id=NEW.platform_id AND ((NEW.latest_refs+NEW.history_refs)>0) AND (captured_ns IS NULL OR captured_ns<(SELECT captured_ns FROM observations WHERE id=NEW.observation_id));
 UPDATE platform_totals SET
 captured_ns=(SELECT max(o.captured_ns) FROM platform_observations r JOIN observations o ON o.id=r.observation_id WHERE r.platform_id=NEW.platform_id AND r.latest_refs+r.history_refs>0),
 captured_at=(SELECT o.captured_at FROM platform_observations r JOIN observations o ON o.id=r.observation_id WHERE r.platform_id=NEW.platform_id AND r.latest_refs+r.history_refs>0 ORDER BY o.captured_ns DESC LIMIT 1)
 WHERE platform_id=NEW.platform_id AND NEW.latest_refs+NEW.history_refs=0 AND captured_ns=(SELECT captured_ns FROM observations WHERE id=NEW.observation_id);
END;
CREATE TRIGGER IF NOT EXISTS latest_summary_insert AFTER INSERT ON latest BEGIN
 UPDATE platform_totals SET latest_rows=latest_rows+1 WHERE platform_id=NEW.platform_id;
 INSERT INTO platform_observations(platform_id,observation_id,latest_refs) VALUES(NEW.platform_id,NEW.observation_id,1)
 ON CONFLICT(platform_id,observation_id) DO UPDATE SET latest_refs=latest_refs+1;
END;
CREATE TRIGGER IF NOT EXISTS history_summary_insert AFTER INSERT ON history BEGIN
 UPDATE platform_totals SET history_rows=history_rows+1 WHERE platform_id=NEW.platform_id;
 INSERT INTO platform_observations(platform_id,observation_id,history_refs) VALUES(NEW.platform_id,NEW.observation_id,1)
 ON CONFLICT(platform_id,observation_id) DO UPDATE SET history_refs=history_refs+1;
END;
CREATE TRIGGER IF NOT EXISTS latest_summary_update AFTER UPDATE OF observation_id ON latest WHEN OLD.observation_id<>NEW.observation_id BEGIN
 UPDATE platform_observations SET latest_refs=latest_refs-1 WHERE platform_id=OLD.platform_id AND observation_id=OLD.observation_id;
 INSERT INTO platform_observations(platform_id,observation_id,latest_refs) VALUES(NEW.platform_id,NEW.observation_id,1)
 ON CONFLICT(platform_id,observation_id) DO UPDATE SET latest_refs=latest_refs+1;
END;
CREATE TRIGGER IF NOT EXISTS history_summary_update AFTER UPDATE OF observation_id ON history WHEN OLD.observation_id<>NEW.observation_id BEGIN
 UPDATE platform_observations SET history_refs=history_refs-1 WHERE platform_id=OLD.platform_id AND observation_id=OLD.observation_id;
 INSERT INTO platform_observations(platform_id,observation_id,history_refs) VALUES(NEW.platform_id,NEW.observation_id,1)
 ON CONFLICT(platform_id,observation_id) DO UPDATE SET history_refs=history_refs+1;
END;
CREATE TRIGGER IF NOT EXISTS latest_summary_delete AFTER DELETE ON latest BEGIN
 UPDATE platform_totals SET latest_rows=latest_rows-1 WHERE platform_id=OLD.platform_id;
 UPDATE platform_observations SET latest_refs=latest_refs-1 WHERE platform_id=OLD.platform_id AND observation_id=OLD.observation_id;
END;
CREATE TRIGGER IF NOT EXISTS history_summary_delete AFTER DELETE ON history BEGIN
 UPDATE platform_totals SET history_rows=history_rows-1 WHERE platform_id=OLD.platform_id;
 UPDATE platform_observations SET history_refs=history_refs-1 WHERE platform_id=OLD.platform_id AND observation_id=OLD.observation_id;
END;

PRAGMA user_version=2;

CREATE TABLE IF NOT EXISTS sample_statistics (
 observation_id INTEGER PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
 count INTEGER NOT NULL CHECK(count>0), mean REAL NOT NULL,
 std_dev REAL, min REAL NOT NULL, max REAL NOT NULL
);
PRAGMA user_version=3;

CREATE TRIGGER IF NOT EXISTS latest_revision_insert AFTER INSERT ON latest BEGIN
 INSERT INTO metadata(key,value) VALUES('latest-revision/'||NEW.platform_id,lower(hex(randomblob(32)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER IF NOT EXISTS latest_revision_update AFTER UPDATE ON latest WHEN OLD.observation_id<>NEW.observation_id OR OLD.snapshot_id IS NOT NEW.snapshot_id BEGIN
 INSERT INTO metadata(key,value) VALUES('latest-revision/'||NEW.platform_id,lower(hex(randomblob(32)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER IF NOT EXISTS latest_revision_delete AFTER DELETE ON latest BEGIN
 INSERT INTO metadata(key,value) VALUES('latest-revision/'||OLD.platform_id,lower(hex(randomblob(32)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER IF NOT EXISTS history_revision_insert AFTER INSERT ON history BEGIN
 INSERT INTO metadata(key,value) VALUES('history-revision/'||NEW.platform_id,lower(hex(randomblob(32)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER IF NOT EXISTS history_revision_update AFTER UPDATE ON history WHEN OLD.observation_id<>NEW.observation_id OR OLD.snapshot_id IS NOT NEW.snapshot_id BEGIN
 INSERT INTO metadata(key,value) VALUES('history-revision/'||NEW.platform_id,lower(hex(randomblob(32)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER IF NOT EXISTS history_revision_delete AFTER DELETE ON history BEGIN
 INSERT INTO metadata(key,value) VALUES('history-revision/'||OLD.platform_id,lower(hex(randomblob(32)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
PRAGMA user_version=4;

CREATE TABLE IF NOT EXISTS blocked_revisions (
 engine TEXT NOT NULL, revision TEXT NOT NULL,
 PRIMARY KEY(engine,revision)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS latest_observation ON latest(observation_id);
CREATE INDEX IF NOT EXISTS history_observation ON history(observation_id);
CREATE INDEX IF NOT EXISTS platform_observation_reverse ON platform_observations(observation_id);
CREATE INDEX IF NOT EXISTS observations_samples ON observations(samples_id);
