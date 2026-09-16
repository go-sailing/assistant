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

  /* ------------------- v0.1.0 日程工具集 ------------------- */

  {
    type: 'function',
    function: {
      name: 'create_event',
      description:
        '创建一个日程。日程分两类：普通日程（用户自己要安排的一件事）与任务日程（为某个已有任务安排执行时段，必须传 task_id）。' +
        '用户说「给我约个 15:00-16:00 的会」用普通日程；说「把季度报告安排在明天下午写」用任务日程（先查证任务拿到真实 task_id）。',
      parameters: {
        type: 'object',
        properties: {
          event_type: {
            type: 'string',
            enum: ['normal', 'task'],
            description: '日程类型，默认 normal；传了 task_id 即视为 task',
          },
          task_id: {
            type: 'number',
            description: '任务日程必填：关联任务的真实ID（必须先用 search_tasks/get_task 查证，禁止猜测）',
          },
          title: { type: 'string', description: '日程标题（仅普通日程需要；任务日程的标题取任务标题，不要传）' },
          start_at: {
            type: 'string',
            description: '开始时间，ISO8601 带时区偏移，例如 2026-09-18T15:00:00+08:00',
          },
          end_at: {
            type: 'string',
            description:
              '结束时间，ISO8601 带时区偏移。用户只说了开始时间时按 +1 小时设置，并在回复中说明「默认安排 1 小时」',
          },
          all_day: { type: 'boolean', description: '是否全天日程，默认 false；全天时 start/end 用当天与次日的 00:00' },
          location: { type: 'string', description: '地点，可选' },
          note: { type: 'string', description: '日程备注，可选（与任务备注相互独立）' },
          confirm_conflict: {
            type: 'boolean',
            description:
              '仅当工具返回 need_conflict_confirmation 且用户明确同意「仍要安排」时，才带 true 重新调用',
          },
        },
        required: ['start_at', 'end_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_event',
      description:
        '修改一个已存在的日程（改期、改全天、改地点、改备注、改普通日程标题）。' +
        '不允许修改日程类型与关联任务（想改只能删除后重建）；任务日程的标题由任务决定，不要传。改时间时系统会重新做冲突校验。',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'number', description: '日程ID，必须来自查询结果的真实ID' },
          start_at: { type: 'string', description: '新的开始时间，ISO8601 带时区' },
          end_at: { type: 'string', description: '新的结束时间，ISO8601 带时区' },
          all_day: { type: 'boolean' },
          title: { type: 'string', description: '新的标题（仅普通日程有效）' },
          location: { type: 'string' },
          note: { type: 'string' },
          confirm_conflict: {
            type: 'boolean',
            description: '仅当冲突已告知且用户明确同意后才带 true 重新调用',
          },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_event',
      description: '查询单个日程的详细信息（含关联任务信息、该时段是否与其他日程重叠）。',
      parameters: {
        type: 'object',
        properties: { event_id: { type: 'number' } },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_events',
      description:
        '按日期/日期范围查询日程。用户问「我今天有什么安排」「这周下午都安排了什么」「季度报告安排在什么时候」时使用。' +
        '必须给出 date 或 date_from/date_to，禁止不带时间范围地拉取全部日程。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '单日查询，格式 YYYY-MM-DD（用户本地日期）' },
          date_from: { type: 'string', description: '范围查询起始日期（含），YYYY-MM-DD' },
          date_to: { type: 'string', description: '范围查询结束日期（不含），YYYY-MM-DD' },
          tz: { type: 'string', description: '用户时区，IANA 名称，如 Asia/Shanghai' },
          event_type: { type: 'string', enum: ['normal', 'task'], description: '只看某一类日程' },
          task_id: { type: 'number', description: '只看某个任务的任务日程' },
          sort: { type: 'string', enum: ['start_asc', 'start_desc'], description: '排序，默认 start_asc' },
          limit: { type: 'number', description: '返回条数上限，默认 100' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_events',
      description: '按关键词搜索日程的标题、地点、备注（任务日程同时匹配关联任务标题）。',
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
      name: 'delete_event',
      description:
        '删除单个日程。这是危险操作，调用后系统会先让用户确认，你不需要自行询问，但要向用户说明将要删除的日程。' +
        '删除任务日程只是取消这个安排，不会删除关联任务。',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'number' },
          reason: { type: 'string', description: '删除原因的简短说明，用于向用户展示' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_update_events',
      description:
        '批量改期或批量删除符合筛选条件的日程（如「把下周带彩排的日程都取消」）。' +
        '这是危险操作，系统会先展示影响范围让用户确认。不给 update 即为批量删除。',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            description: '筛选条件，至少提供一个时间范围或关键词，不要留空以免影响全部日程',
            properties: {
              date: { type: 'string', description: '单日，YYYY-MM-DD' },
              date_from: { type: 'string', description: '起始日期（含），YYYY-MM-DD' },
              date_to: { type: 'string', description: '结束日期（不含），YYYY-MM-DD' },
              tz: { type: 'string', description: '用户时区，IANA 名称' },
              event_type: { type: 'string', enum: ['normal', 'task'] },
              task_id: { type: 'number' },
              keyword: { type: 'string', description: '标题/地点/备注关键词' },
            },
          },
          update: {
            type: 'object',
            description: '要更新成的字段（不给表示批量删除）。不能修改日程类型与关联任务。',
            properties: {
              start_at: { type: 'string', description: '统一设置为该开始时间，ISO8601' },
              end_at: { type: 'string', description: '统一设置为该结束时间，ISO8601' },
              all_day: { type: 'boolean' },
              location: { type: 'string' },
              note: { type: 'string' },
            },
          },
        },
        required: ['filter'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clarify_event_selection',
      description:
        '当用户指定的日程存在多个候选、或无法匹配到任何日程时调用，向用户展示候选日程让其选择。调用后不要执行任何写操作。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '向用户提出的澄清问题' },
          candidate_event_ids: {
            type: 'array',
            items: { type: 'number' },
            description: '候选日程ID列表，来自查询结果的真实ID；可以是空数组',
          },
          pending_intent: { type: 'string', description: '用户原本想执行的操作描述，例如「删除日程」' },
        },
        required: ['question'],
      },
    },
  },
];

/** 需要用户在对话中确认后才会执行的危险工具 */
export const DANGEROUS_TOOLS = new Set([
  'delete_task',
  'delete_list',
  'batch_update_tasks',
  'delete_event',
  'batch_update_events',
]);

export const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export function isDangerousTool(name: string): boolean {
  return DANGEROUS_TOOLS.has(name);
}