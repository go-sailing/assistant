import { z } from 'zod';
import { agentKindEnum } from '../../common/validate';

/** 宽容布尔：兼容 "true"/"false" 字符串（前端 query 可能给字符串） */
const boolish = z.preprocess((v) => {
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'true') return true;
    if (v.toLowerCase() === 'false') return false;
  }
  return v;
}, z.boolean());

export const createAgentSchema = z.object({
  name: z.string().min(1, '请输入代理名称'),
  kind: agentKindEnum,
  kind_label: z.string().optional(),
  description: z.string().nullish(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1, '请输入代理名称').optional(),
  kind: agentKindEnum.optional(),
  kind_label: z.string().optional(),
  description: z.string().nullish(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

export const assignAgentSchema = z.object({
  agent_id: z.coerce.number().int().positive(),
  /** 更换代理：允许从 pending / 终态切换（running 必须先取消指派） */
  replace: boolish.optional(),
});

export const confirmQuerySchema = z.object({
  confirm: boolish.optional(),
});

export const agentTasksQuerySchema = z.object({
  state: z.enum(['pending', 'running', 'succeeded', 'failed']).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(100).optional(),
});

export const agentLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(100).optional(),
});
