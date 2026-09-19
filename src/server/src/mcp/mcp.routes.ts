import { Router, type NextFunction, type Request, type Response } from 'express';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { config } from '../config';
import { agentAuthMiddleware, jsonRpcHttpError, type AgentAuthedRequest } from '../middleware/agentAuth';
import { rateLimit } from '../middleware/rateLimit';
import { RpcErrorCode, rpcError } from './jsonrpc';
import { bizCodeOf, handleRpcMessage, type JsonRpcResponse } from './protocol';

/** MCP 端点限流：按代理凭据维度（未鉴权请求已由 agentAuth 先行 401，不会进入限流桶） */
const mcpLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rateLimit.mcpPerMin,
  keyOf: (req) => {
    const agent = (req as AgentAuthedRequest).agent;
    return agent ? `agent:${agent.agentId}` : 'agent:unknown';
  },
  message: 'MCP 调用过于频繁，请稍后再试',
});

function methodOf(message: unknown): string {
  const candidate = message as { method?: unknown };
  return typeof candidate?.method === 'string' ? candidate.method : 'unknown';
}

function toolNameOf(message: unknown): string | undefined {
  const candidate = message as { method?: unknown; params?: { name?: unknown } };
  if (candidate?.method !== 'tools/call') return undefined;
  return typeof candidate.params?.name === 'string' ? candidate.params.name : undefined;
}

export const mcpRoutes = Router();

/**
 * MCP over Streamable HTTP（无状态）：
 * - 单请求 → 单响应；批量（数组）→ 数组响应（保序）；
 * - 通知（无 id）→ 202 且无响应体；
 * - 不返回 Mcp-Session-Id；GET/DELETE 返回 405（本版不提供 server→client 流，SDD 5.1）。
 */
mcpRoutes.post(
  '/mcp',
  agentAuthMiddleware,
  mcpLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    const authed = req as AgentAuthedRequest;
    const agent = authed.agent;
    if (!agent) {
      jsonRpcHttpError(res, 401, 4019, '代理凭据无效或已失效');
      return;
    }

    const body = req.body as unknown;
    const messages = Array.isArray(body) ? body : [body];
    if (messages.length === 0) {
      res.status(400).json(rpcError(null, RpcErrorCode.INVALID_REQUEST, 'Invalid Request'));
      return;
    }

    const started = Date.now();
    void (async () => {
      const responses: JsonRpcResponse[] = [];
      for (const message of messages) {
        const method = methodOf(message);
        const tool = toolNameOf(message);
        try {
          const response = await handleRpcMessage(message, {
            agentId: agent.agentId,
            traceId: authed.traceId,
          });
          if (response) {
            responses.push(response);
            logger.info('agent_mcp_request', {
              agent_id: agent.agentId,
              method,
              tool,
              biz_code: bizCodeOf(response),
              latency_ms: Date.now() - started,
              trace_id: authed.traceId,
            });
          } else {
            logger.info('agent_mcp_request', {
              agent_id: agent.agentId,
              method,
              tool,
              biz_code: 0,
              latency_ms: Date.now() - started,
              trace_id: authed.traceId,
              notification: true,
            });
          }
        } catch (err) {
          next(err);
          return;
        }
      }

      if (responses.length === 0) {
        // 全部为通知：按规范回 202 Accepted，无响应体
        res.status(202).end();
        return;
      }
      res.json(Array.isArray(body) ? responses : responses[0]);
    })().catch(next);
  }
);

mcpRoutes.get('/mcp', (_req: Request, res: Response) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json(rpcError(null, RpcErrorCode.INVALID_REQUEST, '服务端不提供 SSE 流，请使用 POST'));
});

mcpRoutes.delete('/mcp', (_req: Request, res: Response) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json(rpcError(null, RpcErrorCode.INVALID_REQUEST, '无会话，无需删除'));
});

/** /mcp 专用错误处理：把 body 解析失败与业务错误转成 JSON-RPC 形响应 */
export function mcpErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof AppError) {
    // 限流（1006）、鉴权异常等：HTTP 状态表达协议语义，业务码放 data.biz_code
    jsonRpcHttpError(res, err.httpStatus, err.code, err.message);
    return;
  }
  const type = (err as { type?: string })?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json(rpcError(null, RpcErrorCode.PARSE_ERROR, 'Parse error'));
    return;
  }
  logger.error('未预期的 MCP 异常', {
    error: err instanceof Error ? err.message : String(err),
  });
  jsonRpcHttpError(res, 500, 3002, '服务暂时不可用，请重试');
}
