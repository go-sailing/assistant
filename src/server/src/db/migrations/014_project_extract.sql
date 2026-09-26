-- ============================================================
-- 014_project_extract.sql
-- v0.8.0 项目模型抽离：projects 独立建表；tasks 去 task_type/parent_id；
-- 原项目行搬迁（id 直通）；项目关联日程处置；收尾断言。
-- 幂等：IF NOT EXISTS + pg_constraint/列存在性判定 + ON CONFLICT DO NOTHING。
-- 顺序：① 建表 → ② 加 project_id 列 → ③ 搬迁项目行 → ④ 改写成员归属
--      → ⑤ 处理项目关联日程 → ⑥ 删项目行 → ⑦ 删旧列/约束/索引
--      → ⑧ 建外键与新索引 → ⑨ 推进序列 → ⑩ 断言校验 → ⑪ 存量项目状态归一
-- 关键：④ 必须在 ⑥ 之前，且 ④ 需同时清空 parent_id——否则删项目行会沿
--      tasks.parent_id 的自引用外键（ON DELETE CASCADE）级联删掉全部成员任务。
-- ============================================================

-- ① 项目表
CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  note         VARCHAR(2000),
  status       VARCHAR(16) NOT NULL DEFAULT 'todo',
  completed_at TIMESTAMPTZ,
  source       VARCHAR(16) NOT NULL DEFAULT 'manual',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE projects IS
  'v0.8.0 项目：独立实体（无优先级、无截止时间）；status 由成员完成度派生，仅由 ProjectService.recalcStatus 写入';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_projects_status' AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT ck_projects_status
      CHECK (status IN ('todo', 'completed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_projects_source' AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT ck_projects_source
      CHECK (source IN ('manual', 'chat'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_user_status
  ON projects (user_id, status);

-- 序列：id 直通场景下由迁移显式写入，需独立序列供后续自增
CREATE SEQUENCE IF NOT EXISTS projects_id_seq;
ALTER SEQUENCE projects_id_seq OWNED BY projects.id;
ALTER TABLE projects ALTER COLUMN id SET DEFAULT nextval('projects_id_seq');

-- ② tasks 增加 project_id（先不加外键：数据尚未一致）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id INTEGER;

-- ③ 搬迁项目行（id 直通；重复执行安全）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'task_type'
  ) THEN
    EXECUTE $sql$
      INSERT INTO projects (id, user_id, name, note, status, completed_at, source, created_at, updated_at)
      SELECT t.id, t.user_id, t.title, t.note, t.status, t.completed_at, t.source, t.created_at, t.updated_at
      FROM tasks t
      WHERE t.task_type = 'project'
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END $$;

-- ④ 改写成员归属（必须先于 ⑥）：parent_id → project_id
--    这里必须同时把 parent_id 置空：tasks.parent_id 是自引用外键且 ON DELETE CASCADE，
--    若只写 project_id 而保留 parent_id，⑥ 删除项目行时会沿 parent_id 级联删掉全部成员任务
--    （旧模型下成员数量即由此丢失）。
--    以 parent_id 列存在为旧模型标记：迁移完成后列已删除，重跑为安全 no-op
--    （否则动态执行会因列不存在直接报错）。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'parent_id'
  ) THEN
    EXECUTE $sql$
      UPDATE tasks
      SET project_id = COALESCE(project_id, parent_id),
          parent_id  = NULL
      WHERE parent_id IS NOT NULL
        AND parent_id IN (SELECT id FROM projects)
    $sql$;
  END IF;
END $$;

-- ⑤ 项目关联日程处置（决议 T2）：转为普通日程，保留用户数据。
--    同样以 task_type 列存在为旧模型标记：新模型下 events.task_id 恒指向任务，
--    若不守卫，重跑会把 id 恰好等于某个新项目 id 的任务日程误转为普通日程。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'task_type'
  ) THEN
    -- events.title 为 VARCHAR(100)，项目名最长 200，此处截断避免迁移因超长失败
    EXECUTE $sql$
      UPDATE events e
      SET event_type = 'normal',
          task_id    = NULL,
          title      = left(COALESCE((SELECT p.name FROM projects p WHERE p.id = e.task_id), '项目安排'), 100)
      WHERE e.event_type = 'task'
        AND e.task_id IN (SELECT id FROM projects)
    $sql$;
  END IF;
END $$;

-- ⑥ 删除已搬迁的项目行（此时成员已不再引用，安全）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'task_type'
  ) THEN
    EXECUTE $sql$
      DELETE FROM tasks
      WHERE id IN (SELECT id FROM projects)
    $sql$;
  END IF;
END $$;

-- ⑦ 删除旧列 / 约束 / 索引
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_task_type;
DROP INDEX IF EXISTS idx_tasks_user_task_type;
DROP INDEX IF EXISTS idx_tasks_user_project;      -- 原 project 部分索引（依赖 task_type）
DROP INDEX IF EXISTS idx_tasks_parent;
-- 依赖 parent_id 的 idx_tasks_user_root / idx_tasks_user_list_parent 由下面的 DROP COLUMN 一并删除
ALTER TABLE tasks DROP COLUMN IF EXISTS task_type;
ALTER TABLE tasks DROP COLUMN IF EXISTS parent_id;

-- ⑧ 外键与新索引
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_project' AND conrelid = 'tasks'::regclass
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT fk_tasks_project
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_user_project_id
  ON tasks (user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_project_status
  ON tasks (user_id, project_id, status);

-- ⑨ 推进序列到当前最大 id
SELECT setval(
  'projects_id_seq',
  GREATEST(COALESCE((SELECT MAX(id) FROM projects), 1), 1)
);

-- ⑩ 收尾断言（不满足即抛异常 → 整体回滚）
DO $$
DECLARE
  orphan INT;
BEGIN
  SELECT count(*) INTO orphan
  FROM tasks t
  WHERE t.project_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id);

  IF orphan > 0 THEN
    RAISE EXCEPTION '迁移 014 校验失败：存在 % 条任务的 project_id 指向不存在的项目', orphan;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name IN ('task_type', 'parent_id')
  ) THEN
    RAISE EXCEPTION '迁移 014 校验失败：tasks 仍存在 task_type 或 parent_id 列';
  END IF;
END $$;

-- ⑪ 存量项目状态归一（新口径：状态完全由成员完成度派生）
--    旧模型允许手工完成项目，存量可能存在「空项目已完成」「成员未全完成但项目已完成」等
--    与派生规则不一致的行；按新口径一次性归一，避免它们在首次写入前显示出错误的完成态。
--    幂等：仅当派生结果与当前状态不同才写（状态一致的行不动 updated_at）。
--    注意：这里是"迁移期一次性归一"，运行期仍由 ProjectService.recalcStatus 单点维护。
UPDATE projects p
   SET status = d.status,
       completed_at = CASE
         WHEN d.status = 'completed' THEN COALESCE(p.completed_at, now())
         ELSE NULL
       END,
       updated_at = now()
  FROM (
    SELECT pr.id,
           CASE
             WHEN count(t.id) > 0 AND count(t.id) FILTER (WHERE t.status = 'todo') = 0
             THEN 'completed'
             ELSE 'todo'
           END AS status
      FROM projects pr
      LEFT JOIN tasks t ON t.project_id = pr.id
     GROUP BY pr.id
  ) d
 WHERE d.id = p.id
   AND p.status IS DISTINCT FROM d.status;
