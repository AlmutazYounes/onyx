/**
 * Splits host CPU, memory and GPU use into Onyx (its app and everything it started), the local
 * model (Ollama), and everything else. Inputs are `ps` and `ioreg` text, so this stays testable.
 */

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly cpuPercent: number;
  readonly rssBytes: number;
  readonly command: string;
}

/** `ps -Ao pid=,ppid=,pcpu=,rss=,comm=` output; rss is in KiB. */
export function parseProcessRows(output: string): ReadonlyArray<ProcessRow> {
  const rows: ProcessRow[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      cpuPercent: Number(match[3]),
      rssBytes: Number(match[4]) * 1024,
      command: match[5]!.trim(),
    });
  }
  return rows;
}

const isModelProcess = (command: string) => /(^|\/)(ollama|llama-server)$/.test(command);

/** Onyx is the desktop app around the server when there is one, else the server; plus children. */
export function groupProcesses(rows: ReadonlyArray<ProcessRow>, serverPid: number) {
  const byPid = new Map(rows.map((row) => [row.pid, row] as const));
  const children = new Map<number, number[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
  const parent = byPid.get(byPid.get(serverPid)?.ppid ?? -1);
  const root = parent && /\.app\/Contents\/MacOS\//.test(parent.command) ? parent.pid : serverPid;
  const descendants = (start: ReadonlyArray<number>) => {
    const seen = new Set<number>();
    const queue = [...start];
    while (queue.length > 0) {
      const pid = queue.pop()!;
      if (seen.has(pid)) continue;
      seen.add(pid);
      queue.push(...(children.get(pid) ?? []));
    }
    return seen;
  };
  const model = descendants(
    rows.filter((row) => isModelProcess(row.command)).map((row) => row.pid),
  );
  const onyx = descendants([root]);
  for (const pid of model) onyx.delete(pid);
  return { onyx, model };
}

/** Accumulated GPU nanoseconds per process, from `ioreg -r -c AGXDeviceUserClient -l`. */
export function parseGpuClientTimes(output: string): ReadonlyMap<number, number> {
  const times = new Map<number, number>();
  for (const block of output.split("+-o ")) {
    const pid = /"IOUserClientCreator" = "pid (\d+),/.exec(block)?.[1];
    if (!pid) continue;
    let total = 0;
    for (const match of block.matchAll(/"accumulatedGPUTime"=(\d+)/g)) total += Number(match[1]);
    times.set(Number(pid), (times.get(Number(pid)) ?? 0) + total);
  }
  return times;
}

export interface UsageShare {
  /** Fraction of the machine's capacity, 0 to 1. */
  readonly cpu: number;
  readonly memoryBytes: number;
  /** Fraction of the GPU, 0 to 1; null when there is no earlier sample to compare with. */
  readonly gpu: number | null;
}

/**
 * Onyx's and the model's shares. GPU time is split by each group's part of all GPU time since the
 * previous sample, scaled to the device's own utilization, so the parts never exceed the total.
 */
export function shareUsage(input: {
  readonly rows: ReadonlyArray<ProcessRow>;
  readonly groups: ReturnType<typeof groupProcesses>;
  readonly cpuCount: number;
  readonly cpuUtilization: number | null;
  readonly gpuUtilization: number | null;
  readonly gpuNow: ReadonlyMap<number, number>;
  readonly gpuBefore: ReadonlyMap<number, number> | null;
}): { readonly onyx: UsageShare; readonly model: UsageShare } {
  const gpuDelta = (pids: ReadonlySet<number> | null) => {
    let total = 0;
    for (const [pid, time] of input.gpuNow) {
      if (pids && !pids.has(pid)) continue;
      total += Math.max(0, time - (input.gpuBefore?.get(pid) ?? time));
    }
    return total;
  };
  const allGpu = input.gpuBefore ? gpuDelta(null) : 0;
  const share = (pids: ReadonlySet<number>): UsageShare => {
    const group = input.rows.filter((row) => pids.has(row.pid));
    const cpu = group.reduce((sum, row) => sum + row.cpuPercent, 0) / (input.cpuCount * 100);
    return {
      cpu: Math.min(cpu, input.cpuUtilization ?? 1),
      memoryBytes: group.reduce((sum, row) => sum + row.rssBytes, 0),
      gpu:
        input.gpuBefore === null || input.gpuUtilization === null
          ? null
          : allGpu > 0
            ? (gpuDelta(pids) / allGpu) * input.gpuUtilization
            : 0,
    };
  };
  return { onyx: share(input.groups.onyx), model: share(input.groups.model) };
}
