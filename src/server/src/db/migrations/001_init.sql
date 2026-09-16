-- 个人助手 MVP 初始化表结构（对应系统设计文档 5.2 节）
-- 说明：ID 使用 SERIAL（int4），保证 node-postgres 直接返回 number

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  status        SMALLINT NOT NULL DEFAULT 1,           -- 1 正常 0 已注销
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_lists (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(50) NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lists_user ON task_lists(user_id);
-- 每个用户最多一个默认清单
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lists_default
  ON task_lists(user_id) WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS tasks (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id      INTEGER NOT NULL REFERENCES task_lists(id),
  title        VARCHAR(200) NOT NULL,
  note         VARCHAR(2000),
  status       VARCHAR(16) NOT NULL DEFAULT 'todo',     -- todo / completed
  priority     VARCHAR(16) NOT NULL DEFAULT 'none',     -- none / low / medium / high
  due_at       TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due ON tasks(user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user_list ON tasks(user_id, list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(100) NOT NULL DEFAULT '新对话',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conv_user_updated ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            VARCHAR(16) NOT NULL,                 -- user / assistant
  content         TEXT,
  payload         JSONB,                                -- { blocks: [...] }
  client_msg_id   VARCHAR(64),                          -- 幂等键（仅 user 消息）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_msg_client_id
  ON messages(conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pending_actions (
  id              UUID PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name       VARCHAR(64) NOT NULL,
  params          JSONB NOT NULL,
  affected        JSONB NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending / confirmed / canceled / expired
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pending_conv ON pending_actions(conversation_id, status);

CREATE TABLE IF NOT EXISTS tool_invocations (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  conversation_id INTEGER,
  tool_name       VARCHAR(64) NOT NULL,
  arguments       JSONB NOT NULL,
  result          JSONB,
  success         BOOLEAN NOT NULL,
  error           TEXT,
  latency_ms      INTEGER,
  trace_id        VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tool_user_created ON tool_invocations(user_id, created_at DESC);