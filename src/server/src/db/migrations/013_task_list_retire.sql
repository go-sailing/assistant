-- ============================================================
-- 013_task_list_retire.sql
-- v0.7.0 清单功能下线：任务归属一次性归位到各用户默认清单，
-- 并清理自定义清单行。保留 task_lists 表与 tasks.list_id 列。
-- 幂等：三步均为条件写，重跑为 no-op。
-- 执行顺序不可颠倒：先兜底默认清单 → 再归位 → 最后删自定义清单。
-- ============================================================

-- ① 兜底：保证每个用户都存在一条默认清单（异常数据修复）
INSERT INTO task_lists (user_id, name, is_default)
SELECT u.id, '默认清单', TRUE
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM task_lists l WHERE l.user_id = u.id AND l.is_default = TRUE
);

-- ② 任务归位：全部任务（含项目与项目成员）list_id → 该用户默认清单
UPDATE tasks AS t
SET list_id = d.id
FROM task_lists AS d
WHERE d.user_id = t.user_id
  AND d.is_default = TRUE
  AND t.list_id <> d.id;

-- ③ 清理自定义清单：仅删除已无任务引用的非默认清单（保留守卫，绝不误删）
DELETE FROM task_lists AS l
WHERE l.is_default = FALSE
  AND NOT EXISTS (SELECT 1 FROM tasks AS t WHERE t.list_id = l.id);
