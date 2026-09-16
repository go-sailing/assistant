-- v0.2.0 子任务：tasks 自引用父子关系（对应系统设计文档 5.3 节）
-- 存量任务 parent_id = NULL 即根任务，零回填

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id INTEGER
  REFERENCES tasks(id) ON DELETE CASCADE;

-- 子树查询 / 移动校验
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
-- 根任务列表（任务首页 root_only）
CREATE INDEX IF NOT EXISTS idx_tasks_user_root
  ON tasks(user_id) WHERE parent_id IS NULL;
-- 同清单父子查询
CREATE INDEX IF NOT EXISTS idx_tasks_user_list_parent ON tasks(user_id, list_id, parent_id);
