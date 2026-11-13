/**
 * 单写入队列（05 §七）：同一持久化介质上的所有写操作串行化。
 * 纯 TS、零平台依赖，Node 与浏览器适配器共用；跨实例互斥（同一 JS 运行时内）。
 * 跨浏览器标签页 / 跨进程的互斥由 pending_writes 意图日志兜底，实测报告须明示边界。
 */
export type WriteQueue = <T>(operation: () => Promise<T>) => Promise<T>;

export function createWriteQueue(): WriteQueue {
  let tail: Promise<void> = Promise.resolve();
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

const queues = new Map<string, WriteQueue>();

export function sharedWriteQueue(key: string): WriteQueue {
  let queue = queues.get(key);
  if (!queue) {
    queue = createWriteQueue();
    queues.set(key, queue);
  }
  return queue;
}
