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
      description:
        '创建一个新任务。task_type=normal（默认）为普通任务；task_type=project 为项目（一组相关任务的容器）。' +
        '用户表达「提醒我做某事」用 normal；用户说「建个项目」或一件事包含 ≥2 个相关任务时用 project。',
      parameters: {
        type: 'object',
        properties: {
          task_type: {
            type: 'string',
            enum: ['normal', 'project'],
            description: '任务类型，默认 normal。project 的 parent_id 必须为空（项目为顶层）。',
          },
          title: { type: 'string', description: '任务标题；task_type=project 时为项目名称，必填' },
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
          parent_id: {
            type: 'number',
            description:
              '挂载到项目下时传项目任务的真实 ID：普通任务的父只能是 project。' +
              '创建「带成员的项目」时必须先 create_task(task_type=project) 取得返回的项目 ID，' +
              '再以该 ID 作为 parent_id 依次创建成员；禁止猜测 ID，禁止把任务挂到普通任务下。',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: '修改一个已存在任务的字段（标题/备注/优先级/截止时间/所属清单/所属父任务）。',
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
          parent_id: {
            type: 'number',
            description:
              '所属项目（v0.6.0）：传项目任务真实 ID = 移入该项目成为成员；传 0 或 null = 移出成为独立任务。' +
              '不能挂到普通任务下；project 任务不能移动到任何父任务下。移入须与项目同清单。',
          },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description:
        '把任务标记为已完成或恢复为未完成。' +
        '完成一个还有未完成成员的项目时，系统会返回 need_cascade_confirmation 并要求用户确认后级联完成；' +
        '取消完成只作用于该任务本身，不会影响成员任务。',
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
      description: '查询单个任务的详细信息（含所属项目、任务类型与项目成员进度）。',
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
      name: 'get_task_subtree',
      description:
        '查询项目的成员列表（项目 + 直接成员，成员仅一层）。普通任务没有成员，仅返回自身。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'number', description: '项目任务ID' },
          depth: { type: 'number', description: '保留字段：成员仅一层，传与不传结果相同' },
        },
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
          task_type: {
            type: 'string',
            enum: ['normal', 'project'],
            description: '按任务类型筛选：project=只看项目，normal=只看普通任务；缺省不过滤',
          },
          root_only: { type: 'boolean', description: '只看根任务（项目与独立任务），默认 false' },
          parent_id: { type: 'number', description: '只看某个项目的直接成员' },
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
          recurrence: {
            type: 'object',
            description:
              '（v0.2.0）重复规则：只有**普通日程**可循环，任务日程禁止带该字段。' +
              '频率、时间、结束条件任一缺失或有歧义时必须先追问，不要猜测；不要向用户输出这段 JSON。',
            properties: {
              freq: {
                type: 'string',
                enum: ['daily', 'weekly', 'monthly', 'yearly'],
                description: '每天/每周/每月/每年',
              },
              interval: { type: 'number', description: '间隔，1~99，默认 1（如「每两周」=2）' },
              by_week_days: {
                type: 'array',
                items: { type: 'number' },
                description:
                  '仅 weekly：0=周日、1=周一 … 6=周六；缺省取首次时间所在星期。' +
                  '与 week_mode 互斥（用户说的是"工作日/上班日"时不要用本字段）',
              },
              week_mode: {
                type: 'string',
                enum: ['workdays_cn'],
                description:
                  '（v0.4.0）仅 weekly，且必须与 by_week_days 互斥：' +
                  '填 workdays_cn 表示「法定工作日」——避开法定节假日、调休补班日照常执行。' +
                  '用户在说「每个工作日/上班日」时用它；说「周一到周五」时用 by_week_days:[1,2,3,4,5]。' +
                  '该模式不支持隔周（interval 必须为 1）。',
              },
              month_rule: {
                type: 'object',
                description: '仅 monthly：指定「每月第几日」或「每月第几个周几」',
                properties: {
                  type: { type: 'string', enum: ['day_of_month', 'day_of_week'] },
                  day: { type: 'number', description: 'day_of_month：1~31（小月落到月末）' },
                  ord: { type: 'number', description: 'day_of_week：1~4 或 -1（最后一个）' },
                  weekday: { type: 'number', description: 'day_of_week：0=周日 … 6=周六' },
                },
              },
              by_month_day: {
                type: 'object',
                description:
                  '（v0.3.0）仅 yearly：指定每年重复的**公历**月日，可与开始日期不同（如开始日是 9 月 17 日、' +
                  '用户说「每年 6 月 1 日体检」则传 {month:6,day:1}）。缺省取开始日期的月日。' +
                  '与 by_lunar_month_day 互斥。',
                properties: {
                  month: { type: 'number', description: '1~12' },
                  day: { type: 'number', description: '1~31（该月无此日时落到当月最后一天）' },
                },
              },
              by_lunar_month_day: {
                type: 'object',
                description:
                  '（v0.4.0）仅 yearly：指定每年重复的**农历**月日，公历日期逐年浮动（如「每年农历八月十五」' +
                  '传 {month:8,day:15}、「每年腊月三十」传 {month:12,day:30}）。' +
                  '只支持正常月（1=正月 … 12=腊月），不支持指定闰月；day 传 1~30，' +
                  '该农历月为小月时系统自动落到当月最后一天（腊月三十即除夕）。' +
                  '与 by_month_day 互斥；不要自己换算公历日期，也不要向用户输出这段 JSON。',
                properties: {
                  month: { type: 'number', description: '农历月 1~12（1=正月 … 12=腊月，不含闰月）' },
                  day: { type: 'number', description: '农历日 1~30（小月自动落到当月最后一天）' },
                },
              },
              end_type: { type: 'string', enum: ['never', 'count', 'until'], description: '结束条件' },
              count: { type: 'number', description: 'end_type=count：重复次数 1~730' },
              until: { type: 'string', description: 'end_type=until：截止日期 YYYY-MM-DD（含当天）' },
            },
            required: ['freq', 'end_type'],
          },
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
        '修改一个已存在的日程（改期、改全天、改地点、改备注、改普通日程标题、改重复规则）。' +
        '不允许修改日程类型与关联任务（想改只能删除后重建）；任务日程的标题由任务决定，不要传。改时间时系统会重新做冲突校验。' +
        '（v0.2.0）循环日程必须区分作用域：用户说「这次/本次」→ scope=this 必带 occurrence_key；' +
        '「以后每次都」→ scope=series；「从这次开始」→ scope=following 必带 occurrence_key。作用域不明确时先澄清，禁止默认按整条执行。',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'number', description: '日程ID（循环实例传系列ID），必须来自查询结果的真实ID' },
          scope: {
            type: 'string',
            enum: ['series', 'this', 'following'],
            description: '作用域，默认 series（整条）',
          },
          occurrence_key: {
            type: 'string',
            description:
              '实例身份键（原始开始时间的 ISO 串），scope=this/following 必填；' +
              '必须来自 list_events / get_event 的返回，禁止编造',
          },
          start_at: { type: 'string', description: '新的开始时间，ISO8601 带时区' },
          end_at: { type: 'string', description: '新的结束时间，ISO8601 带时区' },
          all_day: { type: 'boolean' },
          title: { type: 'string', description: '新的标题（仅普通日程有效）' },
          location: { type: 'string' },
          note: { type: 'string' },
          recurrence: {
            type: 'object',
            description: '整条改规则时传（scope=series）：结构与 create_event.recurrence 相同',
          },
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
      description:
        '查询单个日程的详细信息（含关联任务信息、该时段是否与其他日程重叠）。' +
        '（v0.2.0）查询循环日程的某一次实例时传 occurrence_key；只传 series_id 返回系列规则与摘要。',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'number', description: '日程ID或循环系列ID' },
          occurrence_key: {
            type: 'string',
            description: '（v0.2.0）实例身份键，必须来自查询结果',
          },
        },
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
          series_id: { type: 'number', description: '（v0.2.0）只看某个循环系列的实例；只给该字段时返回今天起未来一年的实例' },
          recurring_only: { type: 'boolean', description: '（v0.2.0）只看循环日程实例' },
          include_cancelled: { type: 'boolean', description: '（v0.2.0）是否包含「仅本次已取消」的实例' },
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
        '删除日程。这是危险操作，调用后系统会先让用户确认，你不需要自行询问，但要向用户说明将要删除的日程。' +
        '删除任务日程只是取消这个安排，不会删除关联任务。' +
        '（v0.2.0）循环日程：scope=series（默认）删除整条系列且不可恢复（需用户确认）；' +
        '用户说「这次/本次不去」时用 scope=this + occurrence_key，只是取消单次（可恢复），会立即执行。',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'number', description: '日程ID（循环实例传系列ID）' },
          scope: {
            type: 'string',
            enum: ['series', 'this'],
            description: '作用域，默认 series（整条系列）；this = 仅取消本次',
          },
          occurrence_key: {
            type: 'string',
            description: 'scope=this 必填：实例身份键，必须来自 list_events / get_event 的返回',
          },
          reason: { type: 'string', description: '删除原因的简短说明，用于向用户展示' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'restore_occurrence',
      description:
        '（v0.2.0）恢复一次「仅本次已取消」的循环实例。用户说「那次安排恢复一下」时使用。',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'number', description: '循环系列ID（必须来自查询结果）' },
          occurrence_key: { type: 'string', description: '实例身份键，必须来自查询结果' },
        },
        required: ['event_id', 'occurrence_key'],
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
  {
    type: 'function',
    function: {
      name: 'resolve_lunar_date',
      description:
        '（v0.4.0）把农历月日换算为公历日期。用户给出农历日期要求**单次**安排时'
        + '（如「今年农历九月初九安排体检」），必须先用本工具拿到公历日期，再创建日程；禁止自己心算。'
        + '返回值同时带节日名与是否发生小月回落。',
      parameters: {
        type: 'object',
        properties: {
          lunar_year: {
            type: 'number',
            description: '农历年份（公历年号，1900~2100）；用户说「今年」时用当前年份',
          },
          month: { type: 'number', description: '农历月 1~12（1=正月 … 12=腊月，不支持闰月）' },
          day: { type: 'number', description: '农历日 1~30；该月为小月时系统自动落到当月最后一天' },
        },
        required: ['lunar_year', 'month', 'day'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'present_proposal',
      description:
        '（v0.4.0）写操作意图明确、只缺**非关键**参数时，用合理默认补齐后向用户展示一个完整方案征求确认。' +
        '这是默认工作方式：不要为单个参数反复追问。' +
        '禁止用于：查询类需求（直接回答即可）、删除/批量等危险动作（仍走系统确认）、' +
        '多候选/对象不存在/时间无法换算等硬边界（仍走 clarify 或追问）。' +
        '一次回复最多给一个方案；调用后本轮结束，用户确认（说「就这么办」或点按钮）后' +
        '你再用**完全相同的参数**调用真实工具执行。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '方案的动作名，如「创建日程」「创建任务」「修改日程」',
          },
          params: {
            type: 'array',
            description:
              '方案的参数行（用户一眼可读的中文值，不要放 JSON 或技术细节）。' +
              'defaulted=true 标记这是你替用户补的默认值，必须如实标记。',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '参数名，如「标题」「时间」「重复」「所属清单」' },
                value: { type: 'string', description: '参数值，如「季度复盘」「明天 15:00–16:00」「长期重复」' },
                defaulted: { type: 'boolean', description: '是否为你补的默认值' },
              },
              required: ['label', 'value'],
            },
          },
          note: {
            type: 'string',
            description:
              '默认项集中说明，把所有替用户默认的参数讲清楚，例如'
              + '「未指定具体时间，我按 15:00 安排；重复按不重复处理」。',
          },
        },
        required: ['title', 'params'],
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

/**
 * 按调用参数判定是否危险：
 * delete_event 在 scope=this（仅取消本次、可恢复）时无需确认，直接执行；
 * 其余情况沿用 v0.1.0 的确认门控。
 */
export function isDangerousCall(name: string, args: unknown): boolean {
  if (!DANGEROUS_TOOLS.has(name)) return false;
  if (name === 'delete_event') {
    const scope = (args as Record<string, unknown> | null | undefined)?.scope;
    return scope !== 'this';
  }
  return true;
}