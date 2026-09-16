import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { idParam, parse } from '../../common/validate';
import { getUser } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { conversationService } from './conversation.service';
import { chatOrchestrator, type SseEmitter } from './chat.orchestrator';
import type { AuthedRequest } from '../../middleware/auth';

const chatBodySchema = z.object({
  // 去除首尾空白后不能为空，避免纯空格消息触发一次无意义的模型调用
  content: z
    .string()
    .min(1, '消息内容不能为空')
    .max(2000, '消息过长')
    .refine((v) => v.trim().length > 0, '消息内容不能为空'),
  client_msg_id: z.string().max(64).optional(),
  /** 客户端时区偏移（分钟，东八区为 480），用于正确解析「明天」「下周五」 */
  timezone_offset: z.number().int().min(-840).max(840).optional(),
});

const createConversationSchema = z.object({ title: z.string().max(100).optional() });
const renameConversationSchema = z.object({ title: z.string().min(1).max(100) });

const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rateLimit.chatPerMin,
  keyOf: (req: AuthedRequest) => String((req as AuthedRequest).user?.id ?? 'anonymous'),
  message: '对话请求过于频繁，请稍后再试',
});

export const chatRoutes = Router();

chatRoutes.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    ok(res, await conversationService.listByUser(user.id));
  })
);

chatRoutes.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { title } = parse(createConversationSchema, req.body ?? {}, '会话参数');
    ok(res, await conversationService.create(user.id, title));
  })
);

chatRoutes.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '会话 ID');
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.page_size ?? 50);
    ok(res, await conversationService.listMessages(user.id, id, page, pageSize));
  })
);

chatRoutes.patch(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '会话 ID');
    const { title } = parse(renameConversationSchema, req.body, '会话参数');
    ok(res, await conversationService.rename(user.id, id, title));
  })
);

chatRoutes.delete(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '会话 ID');
    await conversationService.remove(user.id, id);
    ok(res, { id });
  })
);

/**
 * 发送消息：SSE 流式响应。
 * 事件协议见系统设计文档 6.3。
 */
chatRoutes.post(
  '/conversations/:id/chat',
  chatLimiter,
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const conversationId = parse(idParam, req.params.id, '会话 ID');
    const body = parse(chatBodySchema, req.body, '消息参数');
    const authed = req as AuthedRequest;

    // 校验会话归属（失败时还未写 SSE 头，可走统一错误处理）
    await conversationService.getOwned(user.id, conversationId);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    // 连接头交由 Node 自行管理，避免与代理层的 keep-alive 处理冲突
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const controller = new AbortController();

    const emit: SseEmitter = (event, data) => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, 15_000);

    req.on('close', () => {
      closed = true;
      controller.abort();
      clearInterval(heartbeat);
    });

    try {
      await chatOrchestrator.run(
        {
          userId: user.id,
          conversationId,
          content: body.content,
          clientMsgId: body.client_msg_id,
          timezoneOffsetMinutes:
            body.timezone_offset ?? -new Date().getTimezoneOffset(),
          traceId: authed.traceId,
        },
        emit,
        controller.signal
      );
    } catch (err) {
      logger.error('对话流异常终止', {
        trace_id: authed.traceId,
        conversation_id: conversationId,
        error: (err as Error).message,
      });
      emit('error', { code: 3002, message: '助手处理失败，请稍后重试', retryable: true });
      emit('done', { finish_reason: 'error' });
    } finally {
      clearInterval(heartbeat);
      if (!closed) {
        closed = true;
        res.end();
      }
    }
  })
);

/** 确认执行待确认动作（删除 / 批量修改 / 删除清单） */
chatRoutes.post(
  '/conversations/:id/pending-actions/:pendingId/confirm',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const conversationId = parse(idParam, req.params.id, '会话 ID');
    const pendingActionId = String(req.params.pendingId);
    const authed = req as AuthedRequest;

    const result = await chatOrchestrator.confirm({
      userId: user.id,
      conversationId,
      content: '',
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      pendingActionId,
      traceId: authed.traceId,
    });
    ok(res, result);
  })
);

chatRoutes.post(
  '/conversations/:id/pending-actions/:pendingId/cancel',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const conversationId = parse(idParam, req.params.id, '会话 ID');
    const pendingActionId = String(req.params.pendingId);

    const result = await chatOrchestrator.cancel({
      userId: user.id,
      conversationId,
      content: '',
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      pendingActionId,
    });
    ok(res, result);
  })
);