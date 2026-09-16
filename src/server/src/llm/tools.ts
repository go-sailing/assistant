import type { LlmTool } from './types';

/**
 * LLM 可调用的工具白名单（对应 PRD 5.3 能力对照表与系统设计文档 7.3）。
 * 客户端不可直接调用，仅由对话编排在内执行。
 */
export const TOOL_DEFINITIONS: LlmTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: '创建一个新任务。用户表达「提醒我做某事」「记一下…」时使用。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '任务标题，必填' },
          note: { type: 'string', description: '备注，可选' },
          priority: {
            type: 'string',
            enum: ['none', 'low', 'medium', 'high'],
            description: '优先级，默认 none',
          },
          due_at: {
            type: 'string',
            description:
              '截止时间，ISO8601 带时区偏移，例如 2026-09-21T10:00:00+08:00。只有日期时用 00:00:00 表示当天。无法确定时不要传。',
          },
          list_name: {
            type: 'string',
            description: '所属清单名称。用户提到清单名但你不确定是否存在时传名称，系统会自动匹配或落到默认清单。',
          },
          list_id: { type: 'number', description: '所属清单ID，仅在明确知道清单ID时使用' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: '修改一个已存在任务的字段（标题/备注/优先级/截止时间/所属清单）。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'number', description: '任务ID，必须来自查询结果的真实ID' },
          title: { type: 'string' },
          note: { type: 'string' },
          priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
          due_at: { type: 'string', description: 'ISO8601 带时区偏移；传空字符串表示清除截止时间' },
          list_name: { type: 'string', description: '目标清单名称' },
          list_id: { type: 'number', description: '目标清单ID' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description: '把任务标记为已完成或恢复为未完成。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'number', description: '任务ID' },
          status: { type: 'string', enum: ['todo', 'completed'], description: '目标状态' },
        },
        required: ['task_id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_task',
      description: '查询单个任务的详细信息。',
      parameters: {
        type: 'object',
        properties: { task_id: { type: 'number' } },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: '按条件查询任务列表。用户问「我今天要做什么」「有哪些没完成的」时使用。',
      parameters: {
        type: 'object',
        properties: {
          list_name: { type: 'string', description: '限定清单名称' },
          list_id: { type: 'number' },
          status: { type: 'string', enum: ['todo', 'completed'] },
          priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
          due_from: { type: 'string', description: '截止时间下限，ISO8601 带时区' },
          due_to: { type: 'string', description: '截止时间上限，ISO8601 带时区' },
          sort: {
            type: 'string',
            enum: ['due_at_asc', 'due_at_desc', 'created_at_asc', 'created_at_desc'],
            description: '排序，默认 due_at_asc',
          },
          limit: { type: 'number', description: '返回条数上限，默认 50' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_tasks',
      description: '按关键词搜索任务标题与备注。',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string' } },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_list',
      description: '新建一个清单。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_lists',
      description:
        '查询用户的所有清单（含 ID 与名称）。需要按名称操作某个清单（重命名/删除/把任务移入）时，先用它拿到真实的清单 ID。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_list',
      description:
        '重命名一个已存在的自定义清单（默认清单不可重命名）。调用前请先用 list_lists 确认清单存在。list_id 与 list_name 至少提供一个。',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'number' },
          list_name: { type: 'string', description: '要重命名的清单名称，系统会按名称匹配为真实 ID' },
          name: { type: 'string', description: '新的清单名称' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description:
        '删除单个任务。这是危险操作，调用后系统会先让用户确认，你不需要自行询问，但要向用户说明将要删除的任务。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'number' },
          reason: { type: 'string', description: '删除原因的简短说明，用于向用户展示' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_list',
      description:
        '删除一个已存在的自定义清单（其中任务会迁移到默认清单，不会被删除）。调用前请先用 list_lists 确认清单存在。这是危险操作，系统会先让用户确认。list_id 与 list_name 至少提供一个。',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'number' },
          list_name: { type: 'string', description: '要删除的清单名称，系统会按名称匹配为真实 ID' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_update_tasks',
      description:
        '批量修改符合筛选条件的任务（如「把本周逾期任务都延到明天」）。这是危险操作，系统会先展示影响范围让用户确认。',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            description: '筛选条件，至少提供一个条件，不要留空以免影响全部任务',
            properties: {
              list_name: { type: 'string' },
              list_id: { type: 'number' },
              status: { type: 'string', enum: ['todo', 'completed'] },
              priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
              due_before: { type: 'string', description: '截止时间早于该时间，ISO8601' },
              due_after: { type: 'string', description: '截止时间晚于该时间，ISO8601' },
              keyword: { type: 'string', description: '标题/备注关键词' },
            },
          },
          update: {
            type: 'object',
            description: '要更新成的字段，至少一个',
            properties: {
              priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
              due_at: { type: 'string', description: '统一设置为该截止时间，ISO8601' },
              status: { type: 'string', enum: ['todo', 'completed'] },
              list_name: { type: 'string', description: '统一移动到该清单' },
            },
          },
        },
        required: ['filter', 'update'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clarify_task_selection',
      description:
        '当用户指定的任务存在多个候选、或无法匹配到任何任务时调用，向用户展示候选任务让其选择。调用后不要执行任何写操作。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '向用户提出的澄清问题' },
          candidate_task_ids: {
            type: 'array',
            items: { type: 'number' },
            description: '候选任务ID列表，来自查询结果的真实ID；可以是空数组',
          },
          pending_intent: {
            type: 'string',
            description: '用户原本想执行的操作描述，例如「删除任务」',
          },
        },
        required: ['question'],
      },
    },
  },
];

/** 需要用户在对话中确认后才会执行的危险工具 */
export const DANGEROUS_TOOLS = new Set(['delete_task', 'delete_list', 'batch_update_tasks']);

export const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export function isDangerousTool(name: string): boolean {
  return DANGEROUS_TOOLS.has(name);
}