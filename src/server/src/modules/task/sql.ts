/**
 * 任务领域的公共 SQL 片段（v0.8.0）。
 *
 * 独立成文件是为了让 TaskService 与 ProjectService 共用同一份查询与排序口径，
 * 同时避免 ProjectService 依赖 TaskService（二者互相调用会形成循环依赖）。
 */
import { normalizeSort } from './types';

/**
 * 任务查询公共 SELECT：
 * - v0.8.0：成员进度聚合移除（进度归项目），改为带出所属项目名，
 *   项目摘要随任务 DTO 一并返回，端上不再逐条请求项目；
 * - 代理维度仍 LEFT JOIN agents（代理删除后 agent_name 为 NULL）。
 */
export const TASK_SELECT = `
  SELECT t.*,
         a.name AS agent_name,
         a.last_seen_at AS agent_last_seen_at,
         p.name AS project_name
  FROM tasks t
  LEFT JOIN agents a ON a.id = t.agent_id
  LEFT JOIN projects p ON p.id = t.project_id
`;

/** 任务列表排序（口径不变：NULL 截止时间恒排最后） */
export function orderByTask(sort: string | undefined): string {
  switch (normalizeSort(sort)) {
    case 'due_at_desc':
      return 'ORDER BY (t.due_at IS NULL) ASC, t.due_at DESC, t.id DESC';
    case 'created_at_asc':
      return 'ORDER BY t.created_at ASC, t.id ASC';
    case 'created_at_desc':
      return 'ORDER BY t.created_at DESC, t.id DESC';
    case 'due_at_asc':
    default:
      return 'ORDER BY (t.due_at IS NULL) ASC, t.due_at ASC, t.id DESC';
  }
}
