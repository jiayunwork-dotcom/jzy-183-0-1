-- 测斜监测系统 schema（PostgreSQL 16）

CREATE TABLE IF NOT EXISTS holes (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                 TEXT NOT NULL UNIQUE,
    depth_m              DOUBLE PRECISION NOT NULL,
    spacing_m            DOUBLE PRECISION NOT NULL,
    positive_direction   TEXT NOT NULL,
    checksum_tolerance   DOUBLE PRECISION NOT NULL DEFAULT 0,
    threshold_blue       DOUBLE PRECISION NOT NULL,
    threshold_yellow     DOUBLE PRECISION NOT NULL,
    threshold_red        DOUBLE PRECISION NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT thresholds_increasing CHECK (
        threshold_blue > 0
        AND threshold_blue < threshold_yellow
        AND threshold_yellow < threshold_red
    )
);

CREATE TABLE IF NOT EXISTS probes (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    note       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 标定系数按生效时间保留版本（同一探头可有多条）
CREATE TABLE IF NOT EXISTS calibrations (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    probe_id       BIGINT NOT NULL REFERENCES probes(id),
    factor         DOUBLE PRECISION NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    note           TEXT,
    CONSTRAINT factor_finite CHECK (factor = factor AND factor <> 'Infinity'::double precision AND factor <> '-Infinity'::double precision)
);
CREATE INDEX IF NOT EXISTS idx_calibrations_probe_time ON calibrations(probe_id, effective_from);

-- 基准段
CREATE TABLE IF NOT EXISTS datum_segments (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hole_id                BIGINT NOT NULL REFERENCES holes(id),
    seq                    INTEGER NOT NULL,
    reason                 TEXT NOT NULL CHECK (reason IN ('initial','probe_change','repair','reset')),
    anchor_measurement_id  BIGINT,
    started_at             TIMESTAMPTZ NOT NULL,
    note                   TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (hole_id, seq)
);

CREATE TABLE IF NOT EXISTS measurements (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hole_id      BIGINT NOT NULL REFERENCES holes(id),
    measured_at  TIMESTAMPTZ NOT NULL,
    is_initial   BOOLEAN NOT NULL DEFAULT false,
    operator     TEXT,
    note         TEXT,
    revision     INTEGER NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_measurements_hole_time ON measurements(hole_id, measured_at, created_at);

ALTER TABLE datum_segments
    DROP CONSTRAINT IF EXISTS fk_anchor_measurement;
ALTER TABLE datum_segments
    ADD CONSTRAINT fk_anchor_measurement FOREIGN KEY (anchor_measurement_id)
    REFERENCES measurements(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS reading_rows (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    measurement_id BIGINT NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
    depth          DOUBLE PRECISION NOT NULL,
    a              DOUBLE PRECISION NOT NULL,
    b              DOUBLE PRECISION NOT NULL,
    probe_id_a     BIGINT NOT NULL REFERENCES probes(id),
    probe_id_b     BIGINT NOT NULL REFERENCES probes(id),
    CONSTRAINT readings_finite CHECK (
        depth = depth AND a = a AND b = b
        AND a <> 'Infinity'::double precision AND a <> '-Infinity'::double precision
        AND b <> 'Infinity'::double precision AND b <> '-Infinity'::double precision
    ),
    UNIQUE (measurement_id, depth)
);
CREATE INDEX IF NOT EXISTS idx_reading_rows_m ON reading_rows(measurement_id, depth);

-- 更正留痕（每次成功写入一条）
CREATE TABLE IF NOT EXISTS corrections (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    measurement_id  BIGINT NOT NULL REFERENCES measurements(id),
    actor           TEXT NOT NULL,
    base_revision   INTEGER NOT NULL,
    new_revision    INTEGER NOT NULL,
    payload_before  JSONB NOT NULL,
    payload_after   JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corrections_m ON corrections(measurement_id, created_at);

-- 判级快照（每次重算全孔每测一份，永不覆盖；最新一份 = 按现在数据）
CREATE TABLE IF NOT EXISTS assessment_snapshots (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    measurement_id BIGINT NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
    hole_id        BIGINT NOT NULL REFERENCES holes(id) ON DELETE CASCADE,
    reason         TEXT NOT NULL CHECK (reason IN ('upload','correct','recalc')),
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    fingerprint    TEXT NOT NULL,
    overall_level  TEXT CHECK (overall_level IS NULL OR overall_level IN ('blue','yellow','red')),
    points         JSONB NOT NULL,
    checksums      JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_m_time ON assessment_snapshots(measurement_id, computed_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_hole_time ON assessment_snapshots(hole_id, computed_at);

-- 派生缓存：全量重算后整体替换（delete by hole + insert）
CREATE TABLE IF NOT EXISTS derived_profiles (
    measurement_id    BIGINT PRIMARY KEY REFERENCES measurements(id) ON DELETE CASCADE,
    hole_id           BIGINT NOT NULL REFERENCES holes(id) ON DELETE CASCADE,
    datum_segment_id  BIGINT NOT NULL REFERENCES datum_segments(id),
    displacement      JSONB NOT NULL,
    rates             JSONB NOT NULL,
    overall_level     TEXT,
    splice_delta      DOUBLE PRECISION,
    computed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
