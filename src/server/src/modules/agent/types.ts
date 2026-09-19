import { config } from '../../config';

/** v0.7.0 代理类型（预设工具 + 自定义） */
export type AgentKind = 'claude_code' | 'opencode' | 'pi_agent' | 'custom';
export type AgentStatus = 'enabled' | 'disabled';
/** 任务的代理执行状态（与任务完成状态正交，SDD 4.3） */
export type AgentState = 'none' | 'pending' | 'running' | 'succeeded' | 'failed';
/** 派生连接状态：从未连接 / 已连接（活跃窗口内）/ 离线 */
export type AgentConnection = 'never' | 'online' | 'offline';
export type AgentLogAction =
  | 'assigned'
  | 'unassigned'
  | 'claimed'
  | 'progress'
  | 'succeeded'
  | 'failed'
  | 'retried';

export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  claude_code: 'Claude Code',
  opencode: 'opencode',
  pi_agent: 'pi agent',
  custom: '',
};

export interface AgentRow {
  id: number;
  user_id: number;
  name: string;
  kind: string;
  kind_label: string;
  description: string | null;
  status: string;
  token_hash: string;
  token_prefix: string;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AgentCounts {
  running: number;
  pending: number;
}

/** 端上 DTO：绝不包含 token_hash 与明文 */
export interface AgentDTO {
  id: number;
  name: string;
  kind: AgentKind;
  kind_label: string;
  description: string | null;
  status: AgentStatus;
  token_prefix: string;
  connection: AgentConnection;
  last_seen_at: string | null;
  running_count: number;
  pending_count: number;
  created_at: string;
  updated_at: string;
}

/** 创建/重置凭据响应：明文仅此一次 */
export interface AgentWithToken {
  agent: AgentDTO;
  token: string;
  mcp: { endpoint: string; auth_header: string };
}

export interface AgentLogRow {
  id: number;
  user_id: number;
  task_id: number;
  agent_id: number | null;
  agent_name: string | null;
  action: string;
  content: string | null;
  created_at: Date;
}

export interface AgentLogDTO {
  id: number;
  action: AgentLogAction;
  agent_id: number | null;
  agent_name: string | null;
  content: string | null;
  created_at: string;
}

/** 代理可见的任务载荷（最小化：不含 user/清单/其他代理信息） */
export interface AgentTaskBrief {
  task_id: number;
  title: string;
  note: string | null;
  priority: string;
  due_at: string | null;
  project_title: string | null;
  state: AgentState;
  queued_at: string | null;
  claimed_at: string | null;
}

export interface AgentTaskBriefRow {
  id: number;
  title: string;
  note: string | null;
  priority: string;
  due_at: Date | null;
  project_title: string | null;
  agent_state: string;
  agent_queued_at: Date | null;
  agent_claimed_at: Date | null;
}

export interface CreateAgentInput {
  name: string;
  kind: AgentKind;
  kind_label?: string;
  description?: string | null;
}

export interface UpdateAgentInput {
  name?: string;
  kind?: AgentKind;
  kind_label?: string;
  description?: string | null;
  status?: AgentStatus;
}

/** 连接状态派生：以最近活跃时间与活跃窗口比较 */
export function deriveConnection(lastSeenAt: Date | null): AgentConnection {
  if (!lastSeenAt) return 'never';
  const windowMs = Math.max(1, config.agent.activeWindowMin) * 60_000;
  return Date.now() - lastSeenAt.getTime() <= windowMs ? 'online' : 'offline';
}

export function toAgentDTO(row: AgentRow, counts: AgentCounts): AgentDTO {
  return {
    id: row.id,
    name: row.name,
    kind: (row.kind as AgentKind) ?? 'custom',
    kind_label: row.kind_label,
    description: row.description,
    status: row.status === 'disabled' ? 'disabled' : 'enabled',
    token_prefix: row.token_prefix,
    connection: deriveConnection(row.last_seen_at),
    last_seen_at: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    running_count: Number(counts.running ?? 0),
    pending_count: Number(counts.pending ?? 0),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export function toAgentLogDTO(row: AgentLogRow): AgentLogDTO {
  return {
    id: Number(row.id),
    action: row.action as AgentLogAction,
    agent_id: row.agent_id ?? null,
    agent_name: row.agent_name ?? null,
    content: row.content ?? null,
    created_at: row.created_at.toISOString(),
  };
}

export function toAgentTaskBrief(row: AgentTaskBriefRow): AgentTaskBrief {
  return {
    task_id: row.id,
    title: row.title,
    note: row.note,
    priority: row.priority,
    due_at: row.due_at ? row.due_at.toISOString() : null,
    project_title: row.project_title ?? null,
    state: (row.agent_state as AgentState) ?? 'none',
    queued_at: row.agent_queued_at ? row.agent_queued_at.toISOString() : null,
    claimed_at: row.agent_claimed_at ? row.agent_claimed_at.toISOString() : null,
  };
}
