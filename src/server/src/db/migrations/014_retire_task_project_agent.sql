-- ============================================================
-- 014_retire_task_project_agent.sql
-- v0.8.0 任务 / 项目 / 智能体能力下线（数据侧）。
-- 仅处理 events：存量任务日程 → 普通日程（标题快照），并重建约束、回收失效索引。
-- tasks / task_lists / agents / agent_task_logs 表与列一律保留、停止读写（不删不改）。
-- 幂等可重复执行：DROP ... IF EXISTS + 系统目录判定；转换后重跑为 no-op。
-- 执行顺序：① 放宽旧约束 → ② 回填转换 → ③ 收紧新约束 → ④ 回收索引 → ⑤ 注释。
-- ============================================================

-- ① 放宽旧约束（否则无法把 task 日程改写为 normal）
ALTER TABLE events DROP CONSTRAINT IF EXISTS chk_event_task_link;
ALTER TABLE events DROP CONSTRAINT IF EXISTS chk_event_title;

-- ② 存量任务日程 → 普通日程：标题取关联任务标题快照，解除任务关联
UPDATE events AS e
   SET title      = COALESCE(NULLIF(btrim(t.title), ''), '（原任务日程）'),
       event_type = 'normal',
       task_id    = NULL,
       updated_at = now()
  FROM tasks AS t
 WHERE e.event_type = 'task'
   AND e.task_id = t.id;

-- ②b 防御性兜底：非法残留（event_type='task' 但无关联任务）也统一转为普通日程
UPDATE events
   SET title      = COALESCE(NULLIF(btrim(title), ''), '（原任务日程）'),
       event_type = 'normal',
       task_id    = NULL,
       updated_at = now()
 WHERE event_type = 'task';

-- ③ 收紧新约束（系统目录判定，幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_events_normal_only' AND conrelid = 'events'::regclass
  ) THEN
    -- I1：只剩普通日程，且不再有任务关联
    ALTER TABLE events ADD CONSTRAINT ck_events_normal_only
      CHECK (event_type = 'normal' AND task_id IS NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_events_title' AND conrelid = 'events'::regclass
  ) THEN
    -- I2：普通日程必须有非空标题
    ALTER TABLE events ADD CONSTRAINT ck_events_title
      CHECK (title IS NOT NULL AND btrim(title) <> '');
  END IF;
END $$;

-- ④ 回收失效索引：event_type 恒为常量、task_id 恒为 NULL，均无选择性
DROP INDEX IF EXISTS idx_events_user_type;
DROP INDEX IF EXISTS idx_events_user_task;

-- ⑤ 注释（口径留档）
COMMENT ON COLUMN events.event_type IS
  'v0.8.0：恒为 normal（任务日程已下线，存量已转为普通日程）。列保留以兼容代码回滚，应用不再写入。';
COMMENT ON COLUMN events.task_id IS
  'v0.8.0：恒为 NULL（任务能力已下线）。列保留以兼容代码回滚，应用不再读写。';
