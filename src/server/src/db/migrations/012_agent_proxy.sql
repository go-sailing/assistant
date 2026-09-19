-- ============================================================
-- 012_agent_proxy.sql
-- v0.7.0 智能体代理：agents 表 + tasks 代理执行维度 + 执行日志表。
-- 幂等可重复执行：IF NOT EXISTS + pg_constraint 系统目录判定。
-- 执行顺序：① agents → ② tasks 加列 → ③ 约束 → ④ 日志表 → ⑤ 索引。
-- ============================================================

-- ① 代理表
CREATE TABLE IF NOT EXISTS agents (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(50) NOT NULL,
  kind          VARCHAR(24) NOT NULL,
  kind_label    VARCHAR(30) NOT NULL,
  description   VARCHAR(200),
  status        VARCHAR(16) NOT NULL DEFAULT 'enabled',
  token_hash    CHAR(64) NOT NULL,
  token_prefix  VARCHAR(16) NOT NULL,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agents IS
  'v0.7.0 智能体代理：外部 MCP 工具的接入身份；token 只存 sha256 摘要与前缀';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_agents_kind' AND conrelid = 'agents'::regclass
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT ck_agents_kind
      CHECK (kind IN ('claude_code', 'opencode', 'pi_agent', 'custom'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_agents_status' AND conrelid = 'agents'::regclass
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT ck_agents_status
      CHECK (status IN ('enabled', 'disabled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agents_user_name
  ON agents (user_id, lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agents_token_hash
  ON agents (token_hash);
CREATE INDEX IF NOT EXISTS idx_agents_user
  ON agents (user_id, status, last_seen_at DESC);

-- ② tasks 代理执行维度（存量零回填：agent_state 默认 none）
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_state VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS agent_queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_result VARCHAR(2000);

COMMENT ON COLUMN tasks.agent_state IS
  '代理执行状态：none=未指派，pending=已指派并自动入队待领取，running=执行中（agent_id 为空表示代理已删除），succeeded=代理回报完成，failed=代理回报失败';
COMMENT ON COLUMN tasks.agent_queued_at IS '指派即入队时间（自动下发起点）';
COMMENT ON COLUMN tasks.agent_result IS '代理回报的结果摘要（成功）或失败原因';

-- ③ 一致性约束（系统目录判定，幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_tasks_agent_state' AND conrelid = 'tasks'::regclass
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT ck_tasks_agent_state
      CHECK (agent_state IN ('none', 'pending', 'running', 'succeeded', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_tasks_agent_queued' AND conrelid = 'tasks'::regclass
  ) THEN
    -- 非未指派态必须已入队（I1 的弱化形式；其余一致性由 AgentService 单点保证）
    ALTER TABLE tasks ADD CONSTRAINT ck_tasks_agent_queued
      CHECK (agent_state = 'none' OR agent_queued_at IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_tasks_agent_finished' AND conrelid = 'tasks'::regclass
  ) THEN
    -- 终态必须有结束时间；进行中必须没有（I2）
    ALTER TABLE tasks ADD CONSTRAINT ck_tasks_agent_finished
      CHECK ((agent_state IN ('succeeded', 'failed')) = (agent_finished_at IS NOT NULL));
  END IF;
END $$;

-- ④ 执行记录（时间线，用户可见的业务数据）
CREATE TABLE IF NOT EXISTS agent_task_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  agent_name  VARCHAR(50),
  action      VARCHAR(24) NOT NULL,
  content     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_task_logs IS
  'v0.7.0 代理执行记录时间线；agent_name 为快照，代理删除后仍可显示';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_agent_logs_action' AND conrelid = 'agent_task_logs'::regclass
  ) THEN
    ALTER TABLE agent_task_logs ADD CONSTRAINT ck_agent_logs_action
      CHECK (action IN ('assigned','unassigned','claimed','progress','succeeded','failed','retried'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_logs_task ON agent_task_logs (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_user ON agent_task_logs (user_id, created_at DESC);

-- ⑤ 代理任务索引
CREATE INDEX IF NOT EXISTS idx_tasks_agent_queue
  ON tasks (agent_id, agent_queued_at) WHERE agent_state = 'pending';
CREATE INDEX IF NOT EXISTS idx_tasks_user_agent
  ON tasks (user_id, agent_id, agent_state);
CREATE INDEX IF NOT EXISTS idx_tasks_user_agent_state
  ON tasks (user_id, agent_state);
