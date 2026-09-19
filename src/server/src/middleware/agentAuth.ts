import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../common/logger';
import { agentService } from '../modules/agent/agent.service';

export interface AgentAuth {
  agentId: number;
  userId: number;
  /** 上次活跃时间（透传给节流写入，避免二次查询） */
  lastSeenAt: Date | null;
}

export interface AgentAuthedRequest extends Request {
  agent?: AgentAuth;
  traceId?: string;
}

/** MCP 协议层错误响应：HTTP 状态表达协议语义，业务码放 data.biz_code */
export function jsonRpcHttpError(
  res: Response,
  httpStatus: number,
  bizCode: number,
  message: string
): void {
  res.status(httpStatus).json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32001, message, data: { biz_code: bizCode } },
  });
}

function extractBearer(header: string | undefined): string {
  if (!header) return '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * 代理凭据鉴权（仅挂在 /mcp）：
 * - 无凭据 / 凭据无效 / 凭据已重置 / 代理已停用或已删除 → HTTP 401 + biz_code 4019（统一文案，防枚举）
 * - 成功：挂 req.agent 并按节流刷新 last_seen_at
 */
export const agentAuthMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authed = req as AgentAuthedRequest;
  const token = extractBearer(req.headers.authorization);
  if (!token) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"');
    jsonRpcHttpError(res, 401, 4019, '代理凭据无效或已失效');
    return;
  }

  agentService
    .resolveByToken(token)
    .then((hit) => {
      if (!hit) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"');
        jsonRpcHttpError(res, 401, 4019, '代理凭据无效或已失效');
        return;
      }
      authed.agent = { agentId: hit.agentId, userId: hit.userId, lastSeenAt: hit.lastSeenAt };
      // 节流写入：距上次写库 < 60s 直接跳过，不阻塞请求
      void agentService.touchLastSeen(hit.agentId, hit.lastSeenAt);
      next();
    })
    .catch((err) => {
      logger.error('代理鉴权异常', {
        error: err instanceof Error ? err.message : String(err),
      });
      jsonRpcHttpError(res, 500, 3002, '服务暂时不可用，请重试');
    });
};

export function getAgent(req: Request): AgentAuth {
  const agent = (req as AgentAuthedRequest).agent;
  if (!agent) throw new Error('agent context missing');
  return agent;
}

/** MCP 端点限流键：按代理维度（未鉴权时为未知，交由鉴权中间件先行拦截） */
export function agentLimitKey(req: Request): string {
  const agent = (req as AgentAuthedRequest).agent;
  return agent ? `agent:${agent.agentId}` : 'agent:unknown';
}
