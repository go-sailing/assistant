-- v0.2.0 循环日程：events 增加规则列 + 单次例外覆盖表（对应系统设计文档 5.2 节）
-- 实例虚拟展开、绝不物化：DB 只存系列主记录（recurrence 非空）+ 单次偏离（event_overrides）

ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS derived_from_event_id INTEGER
  REFERENCES events(id) ON DELETE SET NULL;

-- 任务日程禁止循环（DB 兜底，与 Service / zod 三处一致）
ALTER TABLE events DROP CONSTRAINT IF EXISTS chk_event_no_recur_task;
ALTER TABLE events ADD CONSTRAINT chk_event_no_recur_task
  CHECK (event_type = 'normal' OR recurrence IS NULL);

-- 实例单次偏离（虚拟展开的唯一持久化部分）
CREATE TABLE IF NOT EXISTS event_overrides (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id         INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- 实例身份键：按规则推算出的原始开始时间（UTC），不随 modified 新时间漂移
  occurrence_start TIMESTAMPTZ NOT NULL,
  action           VARCHAR(16) NOT NULL,        -- cancelled / modified
  -- modified 时的覆盖字段子集：start_at/end_at/all_day/title/location/note
  patch            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_override_action CHECK (action IN ('cancelled','modified')),
  CONSTRAINT chk_override_patch CHECK (
    action = 'cancelled' OR (action = 'modified' AND patch ? 'start_at')
  ),
  CONSTRAINT uniq_override_occurrence UNIQUE (event_id, occurrence_start)
);

CREATE INDEX IF NOT EXISTS idx_override_user ON event_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_override_event ON event_overrides(event_id, occurrence_start);

-- 活跃系列部分索引（窗口查询只扫循环主记录）
CREATE INDEX IF NOT EXISTS idx_events_recurring_active
  ON events(user_id, start_at) WHERE recurrence IS NOT NULL;
