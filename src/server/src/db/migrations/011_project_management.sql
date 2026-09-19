-- ============================================================
-- 011_project_management.sql
-- v0.6.0 项目管理：tasks 增加任务类型维度；parent_id 层级收窄为
-- 「项目任务 task_type='project' → 项目成员 task_type='normal'」。
-- 幂等可重复执行：IF NOT EXISTS + 系统目录判定 + 拆散谓词守卫。
-- 执行顺序：① 加列 → ② CHECK 约束 → ③ 一次性拆散存量层级 → ④ 索引。
-- ============================================================

-- ① 任务类型列：normal 普通任务 / project 项目任务；存量零回填
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_type VARCHAR(16) NOT NULL DEFAULT 'normal';

COMMENT ON COLUMN tasks.task_type IS
  '任务类型：normal=普通任务（独立单任务，parent_id 只能为空或指向 project），project=项目任务（parent_id 必须为空，可拥有一层成员任务）';

-- ② CHECK 约束（PostgreSQL 无 ADD CONSTRAINT IF NOT EXISTS，以系统目录判定）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_tasks_task_type'
      AND conrelid = 'tasks'::regclass
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT ck_tasks_task_type
      CHECK (task_type IN ('normal', 'project'));
  END IF;
END $$;

-- ③ 一次性层级拆散：存量 parent_id 非空任务的父任务此时全部为普通任务
--    （task_type 默认 normal，尚无项目），将其 parent_id 置空成为独立任务。
--    任务标题/备注/优先级/截止时间/完成状态/关联日程全部不变，仅解除层级。
--    多层子树由同一条 UPDATE 一次拆散（拆散后各层均为根任务）。
--    谓词守卫保证可重复执行：迁移完成后成员任务的父任务 task_type='project'，
--    NOT EXISTS 条件不成立，成员关系不受影响；新模型下「父非项目」的行不可能
--    由服务端写入，因此脚本在任何时点重跑均为安全 no-op。
UPDATE tasks AS child
SET parent_id = NULL
WHERE child.parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tasks AS parent
    WHERE parent.id = child.parent_id
      AND parent.task_type = 'project'
  );

-- ④ 索引：用户维度类型筛选 + project 部分索引
CREATE INDEX IF NOT EXISTS idx_tasks_user_task_type
  ON tasks (user_id, task_type);

CREATE INDEX IF NOT EXISTS idx_tasks_user_project
  ON tasks (user_id, status, due_at)
  WHERE task_type = 'project';
