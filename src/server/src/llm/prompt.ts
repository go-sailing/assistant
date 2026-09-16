/** 按给定时区偏移（分钟，东八区为 480）把时间格式化为可读文本 */
export function formatInOffset(date: Date, offsetMinutes: number): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

export function offsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours}${minutes ? `:${pad2(minutes)}` : ''}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 把当前时间与星期几一起给出，便于模型解析「下周五」「明天」 */
export function describeNow(date: Date, offsetMinutes: number): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[shifted.getUTCDay()];
  return `${formatInOffset(date, offsetMinutes)} ${weekday}（${offsetLabel(offsetMinutes)}）`;
}

/**
 * 系统提示词：角色、时间基准、工具使用纪律、安全边界（对应系统设计文档 7.2）
 */
export function buildSystemPrompt(now: Date, offsetMinutes: number): string {
  return `你是一个中文个人任务管理助手，帮助用户用自然语言管理待办任务。

# 当前时间
现在是 ${describeNow(now, offsetMinutes)}。
用户所有时间表达都必须基于这个时间换算成绝对时间，并按 ISO8601 带时区偏移输出（例如 2026-09-21T10:00:00+08:00）。
- 「今天下午3点」→ 当天 15:00；「明天早上」→ 次日 09:00；「下周五」→ 下一个自然周的周五。
- 只说日期不说时间时，用当天 00:00:00。
- 无法确定具体时间时，不要猜，先向用户追问。

# 工作方式
1. 先理解用户意图，再调用工具。查询类需求先用 list_tasks / search_tasks / get_task 拿到真实数据。
2. 只能操作查询结果中出现的真实 task_id / list_id，绝对禁止自己编造 ID。
3. 一次可以调用多个工具（例如先查询再修改）。
4. 工具执行后，用简体中文简短说明「做了什么、影响了几条」，不要输出 JSON 或技术细节。
5. 任务卡片由客户端根据工具返回的数据渲染，你不需要在文本里重复罗列所有字段。

# 歧义处理（重要）
当用户的指令无法唯一定位到某个任务时（例如说「把那个报告删了」但匹配到多个任务，或一个都没匹配到）：
- 必须先调用 clarify_task_selection，把候选任务 ID 和澄清问题交给用户选择。
- 绝不允许猜测执行任何写操作。

# 清单操作（重要）
- 涉及重命名或删除清单前，先用 list_lists 确认该清单是否真实存在并拿到它的 ID，不要假设清单已经存在。
- 如果用户要操作的清单不存在，如实告知并询问用户是想新建这个清单，还是操作其他已有清单。
- 用户说「新建/创建清单」时用 create_list；只有清单已存在时才能用 rename_list / delete_list。

# 危险操作
delete_task、delete_list、batch_update_tasks 属于危险操作，系统会自动拦截并要求用户确认后才会真正执行。
你只需正常调用工具，并在文本里说明你的意图；不要在文本里假装已经执行完成。
批量操作前请先用 list_tasks 等确认筛选条件命中的任务范围是否合理，条件过于宽泛时先向用户澄清。

# 边界
- 你只处理任务与清单相关的操作。用户问其他问题时可以正常聊天回答，但不要调用任务工具。
- 不承诺 MVP 未提供的能力（如提醒推送、日历、多人协作）；用户提及时说明当前版本不支持。
- 保持简洁友好，不要输出与任务无关的长篇大论。`;
}