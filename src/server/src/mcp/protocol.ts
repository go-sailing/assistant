import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import {
  MCP_INSTRUCTIONS,
  MCP_LATEST_PROTOCOL,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  RpcErrorCode,
  isJsonRpcRequest,
  isNotification,
  rpcError,
  rpcResult,
  type JsonRpcFailure,
  type JsonRpcRequest,
  type JsonRpcSuccess,
} from './jsonrpc';
import { businessErrorOf, findTool, toolListPayload } from './tools.registry';

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

interface ToolCallParams {
  name?: unknown;
  arguments?: unknown;
}

function negotiateVersion(requested: unknown): string {
  if (typeof requested === 'string' && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return MCP_LATEST_PROTOCOL;
}

/** tools/call 的业务失败统一用 isError（MCP 规范推荐），协议错误才用 JSON-RPC error */
function toolErrorResponse(
  id: JsonRpcRequest['id'],
  bizCode: number,
  message: string
): JsonRpcSuccess {
  return rpcResult(id, {
    content: [{ type: 'text', text: message }],
    structuredContent: { error: { code: bizCode } },
    isError: true,
  });
}

/**
 * 处理单条 JSON-RPC 消息。返回 null 表示通知（调用方回 202，不产生响应）。
 * 支持的方法：initialize / notifications/initialized / ping / tools/list / tools/call。
 */
export async function handleRpcMessage(
  raw: unknown,
  ctx: { agentId: number; traceId?: string }
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(raw)) {
    return rpcError(null, RpcErrorCode.INVALID_REQUEST, 'Invalid Request');
  }
  const req = raw;

  // 通知：无 id，处理但不返回响应
  if (isNotification(req)) {
    if (req.method === 'notifications/initialized') return null;
    logger.warn('agent_mcp_notification_unhandled', {
      agent_id: ctx.agentId,
      method: req.method,
      trace_id: ctx.traceId,
    });
    return null;
  }

  switch (req.method) {
    case 'initialize': {
      const params = (req.params ?? {}) as { protocolVersion?: unknown };
      return rpcResult(req.id, {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: MCP_INSTRUCTIONS,
      });
    }

    case 'ping':
      return rpcResult(req.id, {});

    case 'tools/list':
      return rpcResult(req.id, toolListPayload());

    case 'tools/call': {
      const params = (req.params ?? {}) as ToolCallParams;
      if (typeof params.name !== 'string' || !params.name) {
        return rpcError(req.id, RpcErrorCode.INVALID_PARAMS, 'Invalid params: name is required');
      }
      const tool = findTool(params.name);
      if (!tool) {
        return rpcError(req.id, RpcErrorCode.INVALID_PARAMS, `Unknown tool: ${params.name}`);
      }

      const parsed = tool.validator.safeParse(params.arguments ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'arguments'} ${issue.message}`)
          .join('；');
        return toolErrorResponse(req.id, 1001, `参数不合法：${detail}`);
      }

      try {
        const outcome = await tool.handler(ctx.agentId, parsed.data);
        const text = outcome.text ?? JSON.stringify(outcome.payload);
        return rpcResult(req.id, {
          content: [{ type: 'text', text }],
          structuredContent: outcome.payload,
        });
      } catch (err) {
        const biz = businessErrorOf(err);
        if (biz.bizCode === 3002) {
          logger.error('agent_mcp_tool_failed', {
            agent_id: ctx.agentId,
            tool: tool.name,
            trace_id: ctx.traceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return toolErrorResponse(req.id, biz.bizCode, biz.message);
      }
    }

    default:
      return rpcError(req.id, RpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${req.method}`);
  }
}

/** 供路由层统一记录审计/埋点：业务码在响应中已给出，这里只补充上下文 */
export function bizCodeOf(response: JsonRpcResponse): number {
  if ('error' in response) return 0;
  const result = response.result as { isError?: boolean; structuredContent?: { error?: { code?: number } } };
  return result?.structuredContent?.error?.code ?? 0;
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
