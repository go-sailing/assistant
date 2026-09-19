/** MCP 协议版本：按顺序为服务端支持列表（首个为最新） */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;
export const MCP_LATEST_PROTOCOL = MCP_PROTOCOL_VERSIONS[0];
export const MCP_SERVER_NAME = 'personal-assistant';
export const MCP_SERVER_VERSION = '0.7.0';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export const RpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export function rpcResult(id: JsonRpcRequest['id'], result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function rpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown
): JsonRpcFailure {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

/** 通知（无 id）：服务端只回 202，不产生 JSON-RPC 响应 */
export function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined || req.id === null;
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { jsonrpc?: unknown; method?: unknown };
  return candidate.jsonrpc === '2.0' && typeof candidate.method === 'string';
}

/** 服务端下发给代理的使用说明：自动执行闭环的关键引导（SDD 5.3） */
export const MCP_INSTRUCTIONS = [
  '你是个人助手 App 的智能体代理。请按以下闭环工作：',
  '1) 调用 wait_agent_task 等待新任务（无任务时该调用会挂起，超时返回空，请立即重新调用）；',
  '2) 收到任务后调用 claim_agent_task 领取（参数 task_id）；',
  '3) 执行任务；可用 report_task_progress 汇报进度；',
  '4) 完成后调用 complete_agent_task（result 填结果摘要），失败则调用 fail_agent_task（reason 填原因）；',
  '5) 你不可以创建/修改/删除任务、日程或项目；只能处理被指派给你的任务。',
].join('\n');
