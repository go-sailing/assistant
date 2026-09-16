-- 任务创建来源埋点（PRD 6.5「任务创建来源（手动/对话）」、成功指标「对话创建任务占比」）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual';
-- manual：任务页手动创建；chat：对话工具创建
CREATE INDEX IF NOT EXISTS idx_tasks_user_source ON tasks(user_id, source);