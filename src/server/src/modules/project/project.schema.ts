import { z } from 'zod';
import { statusEnum } from '../../common/validate';

/** 项目名称/备注长度上限（与 tasks.title/note 同口径） */
export const PROJECT_NAME_MAX = 200;
export const PROJECT_NOTE_MAX = 2000;

const nameField = z
  .string()
  .min(1, '请输入项目名称')
  .max(PROJECT_NAME_MAX, `项目名称不能超过 ${PROJECT_NAME_MAX} 个字符`);

const noteField = z.string().max(PROJECT_NOTE_MAX, `备注不能超过 ${PROJECT_NOTE_MAX} 个字符`);

export const createProjectSchema = z.object({
  name: nameField,
  note: noteField.nullish(),
});

/** 仅名称与备注可改；status 由 recalcStatus 派生，携带即由路由层显式拒绝（1001） */
export const updateProjectSchema = z.object({
  name: nameField.optional(),
  note: noteField.nullish(),
});

export const projectListQuerySchema = z.object({
  keyword: z.string().optional(),
  status: statusEnum.optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(100).optional(),
});

export const projectMemberQuerySchema = z.object({
  status: statusEnum.optional(),
  keyword: z.string().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  /**
   * 不做上限校验：项目成员的返回上限即「项目成员上限」（config.project.maxMembers，
   * 默认 200），由服务端 listMembers 夹取——端上需要一次性拿到全部成员，
   * 若在 schema 层限制为 100 会让超过 100 个成员的项目详情直接请求失败。
   */
  page_size: z.coerce.number().int().positive().optional(),
});
