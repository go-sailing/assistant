-- v0.1.0 日程领域（对应系统设计文档 5.2 节）
-- 日程分两类：normal（普通日程）/ task（任务日程，链接一个任务作为其执行时段载体）

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  VARCHAR(16) NOT NULL DEFAULT 'normal',   -- normal / task
  task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  -- 普通日程必填（trim 后非空）；任务日程恒为 NULL，展示时取 tasks.title（不存冗余副本）
  title       VARCHAR(100),
  note        VARCHAR(2000),
  location    VARCHAR(200),
  all_day     BOOLEAN NOT NULL DEFAULT FALSE,
  start_at    TIMESTAMPTZ NOT NULL,
  end_at      TIMESTAMPTZ NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'scheduled', -- scheduled / cancelled（本期取消即删除，仅作扩展预留）
  source      VARCHAR(16) NOT NULL DEFAULT 'manual',    -- manual / chat
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 类型与关联必须一致
  CONSTRAINT chk_event_task_link CHECK (
    (event_type = 'normal' AND task_id IS NULL) OR
    (event_type = 'task'   AND task_id IS NOT NULL)
  ),
  -- 任务日程不存标题；普通日程必须有标题
  CONSTRAINT chk_event_title CHECK (
    (event_type = 'task'   AND title IS NULL) OR
    (event_type = 'normal' AND title IS NOT NULL AND btrim(title) <> '')
  ),
  -- 结束不得早于开始（全天单日两端相等合法）
  CONSTRAINT chk_event_time CHECK (end_at >= start_at)
);

-- 冲突检测主索引（时间段相交查询）
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, start_at, end_at);
-- 任务维度查询（排期列表）与删除级联
CREATE INDEX IF NOT EXISTS idx_events_user_task ON events(user_id, task_id);
-- 创建来源/类型埋点
CREATE INDEX IF NOT EXISTS idx_events_user_type ON events(user_id, event_type);