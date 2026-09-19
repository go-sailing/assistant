import { config } from '../config';
import { logger } from '../common/logger';
import { claimableHead } from '../modules/agent/agent.execution';
import type { AgentTaskBrief } from '../modules/agent/types';

interface Waiter {
  agentId: number;
  resolve: () => void;
}

/** agentId → 等待者集合（同进程直接唤醒，无 IPC） */
const waiters = new Map<number, Set<Waiter>>();
let inflight = 0;

/**
 * 唤醒某代理的等待者。返回是否命中（用于 auto_dispatch 埋点）。
 * 先写库提交、后调用本函数；即使唤醒丢失，兜底轮询（默认 2s）仍能捞到任务。
 */
export function notifyAgent(agentId: number): boolean {
  const set = waiters.get(agentId);
  if (!set || set.size === 0) return false;
  for (const waiter of [...set]) waiter.resolve();
  return true;
}

/**
 * 长轮询等待队首可领取任务（v0.7.0「自动下发」的实时机制，SDD 5.5）：
 * 1) 先查库：已有 pending 立即返回（覆盖唤醒丢失与多实例）；
 * 2) 注册等待者：入队提交后 notifyAgent 立即唤醒；
 * 3) 兜底轮询：每 AGENT_WAIT_FALLBACK_POLL_MS 复查一次；
 * 4) 上限：AGENT_WAIT_TIMEOUT_MS（服务端硬上限，超时返回 null 且非错误）。
 */
export async function waitForAgentTask(
  agentId: number,
  timeoutMs: number
): Promise<{ task: AgentTaskBrief | null; waitedMs: number }> {
  const started = Date.now();
  const budget = Math.min(Math.max(0, timeoutMs), config.agent.waitTimeoutMs);

  const hit = await claimableHead(agentId);
  if (hit) return { task: hit, waitedMs: Date.now() - started };
  if (budget === 0) {
    logger.info('agent_wait_completed', { agent_id: agentId, waited_ms: 0, hit: false });
    return { task: null, waitedMs: 0 };
  }
  if (inflight >= config.agent.waitMaxConcurrency) {
    // 过载快速返回（不排队、不报错），客户端可立即重试
    logger.warn('agent_wait_overloaded', { agent_id: agentId, inflight });
    return { task: null, waitedMs: Date.now() - started };
  }

  const task = await new Promise<AgentTaskBrief | null>((resolve) => {
    inflight += 1;
    let done = false;

    const finish = (): void => {
      if (done) return;
      done = true;
      inflight -= 1;
      clearTimeout(timer);
      clearInterval(poll);
      set.delete(waiter);
      // 重新查库：不依赖唤醒事件携带数据，保证不丢任务
      claimableHead(agentId)
        .then((found) => resolve(found))
        .catch(() => resolve(null));
    };

    const waiter: Waiter = { agentId, resolve: finish };
    const timer = setTimeout(finish, budget);
    const poll = setInterval(finish, Math.max(200, config.agent.waitFallbackPollMs));
    const set = waiters.get(agentId) ?? new Set<Waiter>();
    set.add(waiter);
    waiters.set(agentId, set);
  });

  const waitedMs = Date.now() - started;
  logger.info('agent_wait_completed', { agent_id: agentId, waited_ms: waitedMs, hit: Boolean(task) });
  return { task, waitedMs };
}

/** 仅供测试/运维观测 */
export function waitStats(): { inflight: number; agents: number } {
  return { inflight, agents: waiters.size };
}
