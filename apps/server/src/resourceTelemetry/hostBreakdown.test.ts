import { describe, expect, it } from "vite-plus/test";

import {
  groupProcesses,
  parseGpuClientTimes,
  parseProcessRows,
  shareUsage,
} from "./hostBreakdown.ts";

// Trimmed from `ps -Ao pid=,ppid=,pcpu=,rss=,comm=` on a Mac running the Onyx desktop app.
const ps = `
    1     0   0.1  20000 /sbin/launchd
 7628     1   2.0  75456 /Applications/Onyx.app/Contents/MacOS/Onyx
 7643  7628   1.0  89504 /Applications/Onyx.app/Contents/Frameworks/Onyx Helper (Renderer).app/Contents/MacOS/Onyx Helper (Renderer)
 7650  7628   3.0  92336 /Applications/Onyx.app/Contents/MacOS/Onyx
 8008  7650   4.0  63424 /opt/homebrew/bin/opencode
 8100  8008  10.0  10000 /bin/zsh
11917     1   0.0  15088 /opt/homebrew/opt/ollama/bin/ollama
11130 11917  20.0 15951520 /opt/homebrew/Cellar/ollama/0.40.16/libexec/lib/ollama/llama-server
  640     1  30.0 300000 /System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer
`;

// Two clients of one process add up; a client without GPU time still counts as zero.
const ioreg = (llama: number, onyx: number, windowServer: number) => `
+-o AGXDeviceUserClient  <class AGXDeviceUserClient>
    {
      "AppUsage" = ({"API"="Metal","lastSubmittedTime"=1,"accumulatedGPUTime"=${llama}})
      "IOUserClientCreator" = "pid 11130, llama-server"
    }
+-o AGXDeviceUserClient  <class AGXDeviceUserClient>
    {
      "AppUsage" = ({"API"="Metal","lastSubmittedTime"=1,"accumulatedGPUTime"=${onyx}})
      "IOUserClientCreator" = "pid 7643, Onyx Helper (Rende"
    }
+-o AGXDeviceUserClient  <class AGXDeviceUserClient>
    {
      "AppUsage" = ({"API"="Metal","lastSubmittedTime"=1,"accumulatedGPUTime"=${windowServer / 2}},{"API"="Metal","lastSubmittedTime"=1,"accumulatedGPUTime"=${windowServer / 2}})
      "IOUserClientCreator" = "pid 640, WindowServer"
    }
`;

describe("host usage breakdown", () => {
  const rows = parseProcessRows(ps);

  it("counts the whole desktop app as Onyx and Ollama's processes as the model", () => {
    const groups = groupProcesses(rows, 7650);
    expect([...groups.onyx].toSorted()).toEqual([7628, 7643, 7650, 8008, 8100]);
    expect([...groups.model].toSorted()).toEqual([11130, 11917]);
    // A server run from a shell, not inside the app, is its own root.
    expect([...groupProcesses(rows, 8100).onyx]).toEqual([8100]);
  });

  it("splits CPU, memory and GPU into each group's share of the totals", () => {
    const groups = groupProcesses(rows, 7650);
    const before = parseGpuClientTimes(ioreg(1_000, 1_000, 1_000));
    const now = parseGpuClientTimes(ioreg(1_000 + 600, 1_000 + 100, 1_000 + 300));
    const shares = shareUsage({
      rows,
      groups,
      cpuCount: 10,
      cpuUtilization: 0.5,
      gpuUtilization: 0.8,
      gpuNow: now,
      gpuBefore: before,
    });
    expect(shares.onyx.cpu).toBeCloseTo(0.02);
    expect(shares.model.cpu).toBeCloseTo(0.02);
    expect(shares.model.memoryBytes).toBe((15_951_520 + 15_088) * 1024);
    // 600 of 1000 GPU nanoseconds at 80% busy.
    expect(shares.model.gpu).toBeCloseTo(0.48);
    expect(shares.onyx.gpu).toBeCloseTo(0.08);
  });

  it("has no GPU split on the first sample", () => {
    const groups = groupProcesses(rows, 7650);
    const shares = shareUsage({
      rows,
      groups,
      cpuCount: 10,
      cpuUtilization: null,
      gpuUtilization: 0.5,
      gpuNow: parseGpuClientTimes(ioreg(1, 1, 1)),
      gpuBefore: null,
    });
    expect(shares.model.gpu).toBeNull();
  });
});
