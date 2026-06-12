function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class MessageRenderer {
  // ── Utilities ────────────────────────────────────────────
  static bar(pct: number, w = 10): string {
    const fill = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w);
    return '█'.repeat(fill) + '░'.repeat(w - fill);
  }

  static healthIcon(pct: number): string {
    if (pct >= 90) return '🔴';
    if (pct >= 70) return '🟡';
    return '🟢';
  }

  static duration(s: number): string {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  static ago(ts: number): string {
    const diff = Math.floor((Date.now() - ts * 1000) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  static header(text: string): string {
    return `<b>${escapeHtml(text)}</b>\n`;
  }

  static line(label: string, value: string): string {
    return `<b>${escapeHtml(label)}:</b> <code>${escapeHtml(value)}</code>\n`;
  }

  static raw(text: string): string {
    return escapeHtml(text);
  }

  static pad(k: string, n = 9): string {
    return k.padEnd(n, ' ');
  }

  // ── Monitoring Commands ──────────────────────────────────

  /** Full server telemetry card */
  static reportCard(alias: string, ts: number, _cpu: string, cpuPct: number,
    ramUsed: number, ramTotal: number, diskUsed: number, diskTotal: number,
    uptime: number, dockerRunning?: number, dockerTotal?: number, dockerUnhealthy?: number,
  ): string {
    const ramPct = (ramUsed / ramTotal) * 100;
    const diskPct = (diskUsed / diskTotal) * 100;
    const ageMin = Math.max(0, (Date.now() - ts * 1000) / 60000);

    const getHealthState = (val: number, thresholds: { warn: number; crit: number }) => {
      if (val >= thresholds.crit) return 'Critical';
      if (val >= thresholds.warn) return 'Warning';
      return 'Healthy';
    };

    const cpuHealth = getHealthState(cpuPct, { warn: 70, crit: 90 });
    const ramHealth = getHealthState(ramPct, { warn: 75, crit: 90 });
    const diskHealth = getHealthState(diskPct, { warn: 80, crit: 95 });

    let freshnessHealth: 'Healthy' | 'Warning' | 'Critical' = 'Healthy';
    if (ageMin > 30) freshnessHealth = 'Critical';
    else if (ageMin > 10) freshnessHealth = 'Warning';

    let dockerHealth: 'Healthy' | 'Warning' | 'Critical' = 'Healthy';
    if (dockerTotal !== undefined && dockerTotal > 0) {
      if (dockerUnhealthy && dockerUnhealthy > 0) dockerHealth = 'Warning';
      if (dockerRunning !== undefined && dockerRunning < dockerTotal) dockerHealth = 'Critical';
    }

    const healthList = [cpuHealth, ramHealth, diskHealth, freshnessHealth];
    if (dockerTotal !== undefined && dockerTotal > 0) healthList.push(dockerHealth);

    let overallHealth = 'Healthy';
    let healthEmoji = '🟢';
    if (healthList.includes('Critical')) {
      overallHealth = 'Critical';
      healthEmoji = '🔴';
    } else if (healthList.includes('Warning')) {
      overallHealth = 'Warning';
      healthEmoji = '🟡';
    }

    const reasons: string[] = [];
    if (cpuHealth !== 'Healthy') reasons.push(`CPU ${cpuHealth.toLowerCase()}`);
    if (ramHealth !== 'Healthy') reasons.push(`RAM ${ramHealth.toLowerCase()}`);
    if (diskHealth !== 'Healthy') reasons.push(`Disk ${diskHealth.toLowerCase()}`);
    if (freshnessHealth !== 'Healthy') {
      reasons.push(freshnessHealth === 'Critical' ? 'agent offline' : 'agent delayed');
    }
    if (dockerTotal !== undefined && dockerTotal > 0) {
      if (dockerRunning !== undefined && dockerRunning < dockerTotal) {
        reasons.push(`${dockerTotal - dockerRunning} stopped svc`);
      }
      if (dockerUnhealthy && dockerUnhealthy > 0) {
        reasons.push(`${dockerUnhealthy} unhealthy svc`);
      }
    }
    const reasonText = reasons.length > 0 ? reasons.join(', ') : 'None';

    let msg = `<b>Infrastructure Report</b>\n`;
    msg += `<code>┌ Server   ${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Health   ${overallHealth} ${healthEmoji}</code>\n`;
    msg += `<code>└ Reason   ${escapeHtml(reasonText)}</code>\n\n`;

    msg += `<b>Resources</b>\n`;
    msg += `<code>├ CPU      [${this.bar(cpuPct)}] ${cpuPct.toFixed(0)}%</code>\n`;
    msg += `<code>├ Memory   [${this.bar(ramPct)}] ${ramPct.toFixed(0)}%</code>\n`;
    msg += `<code>└ Disk     [${this.bar(diskPct)}] ${diskPct.toFixed(0)}%</code>\n`;

    if (dockerTotal !== undefined) {
      const runningCount = dockerRunning ?? 0;
      const unhealthyCount = dockerUnhealthy ?? 0;
      msg += `\n<b>Containers</b>\n`;
      msg += `<code>├ Running  ${runningCount}/${dockerTotal}</code>\n`;
      msg += `<code>└ Status   ${unhealthyCount > 0 ? `${unhealthyCount} Unhealthy 🔴` : 'Healthy 🟢'}</code>\n`;
    }

    msg += `\n<code>┌ Uptime   ${this.duration(uptime)}</code>\n`;
    msg += `<code>└ Updated  ${this.ago(ts)}</code>`;
    return msg;
  }

  /** Compact uptime card */
  static uptimeCard(alias: string, ts: number, uptime: number, health: string): string {
    let healthEmoji = '🟢';
    if (health === 'Critical') healthEmoji = '🔴';
    else if (health === 'Warning') healthEmoji = '🟡';

    let msg = `<b>System Uptime</b>\n`;
    msg += `<code>┌ Server   ${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Uptime   ${this.duration(uptime)}</code>\n`;
    msg += `<code>├ Health   ${health} ${healthEmoji}</code>\n`;
    msg += `<code>└ Updated  ${this.ago(ts)}</code>`;
    return msg;
  }

  /** Bandwidth card */
  static bandwidthCard(alias: string, ts: number, rx: number, tx: number, limitGB?: number): string {
    const totalGB = (rx + tx) / (1024 ** 3);
    const rxGB = (rx / (1024 ** 3)).toFixed(2);
    const txGB = (tx / (1024 ** 3)).toFixed(2);

    let msg = `<b>Bandwidth Usage</b>\n`;
    msg += `<code>┌ Server   ${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Download ${rxGB} GB</code>\n`;
    msg += `<code>├ Upload   ${txGB} GB</code>\n`;
    msg += `<code>└ Total    ${totalGB.toFixed(2)} GB</code>\n`;

    if (limitGB && limitGB > 0) {
      const usagePct = Math.round((totalGB / limitGB) * 100);
      msg += `\n<b>Quota Limit</b>\n`;
      msg += `<code>└ Usage    [${this.bar(usagePct)}] ${usagePct}% / ${limitGB} GB</code>\n`;
    }

    msg += `\n<code>└ Updated  ${this.ago(ts)}</code>`;
    return msg;
  }

  /** Docker containers card */
  static dockerCard(alias: string, running: number, total: number, unhealthy: number,
    containers: Array<{ name: string; status: string; state: string }>, ts: number
  ): string {
    const healthy = running - unhealthy;
    const issues = total - running + unhealthy;

    let msg = `<b>Container Status</b>\n`;
    msg += `<code>┌ Server   ${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Running  ${running}/${total}</code>\n`;
    msg += `<code>├ Healthy  ${healthy}</code>\n`;
    msg += `<code>└ Issues   ${issues} ${issues > 0 ? '🔴' : '🟢'}</code>\n`;

    const affectedContainers = containers.filter(c => {
      const isRunning = c.state.toLowerCase() === 'running';
      const isUnhealthy = c.status.toLowerCase().includes('unhealthy');
      return !isRunning || isUnhealthy;
    });

    if (affectedContainers.length > 0) {
      msg += `\n<b>Affected Services</b>\n`;
      for (let i = 0; i < affectedContainers.length; i++) {
        const c = affectedContainers[i];
        const isRunning = c.state.toLowerCase() === 'running';
        const isUnhealthy = c.status.toLowerCase().includes('unhealthy');

        const stateText = isRunning ? 'Running' : 'Stopped';
        let healthText = 'Healthy';
        let healthEmoji = '🟢';
        if (!isRunning) {
          healthText = 'Critical';
          healthEmoji = '🔴';
        } else if (isUnhealthy) {
          healthText = 'Unhealthy';
          healthEmoji = '🔴';
        }

        const isLast = i === affectedContainers.length - 1;
        const prefixSymbol = isLast ? '└' : '├';

        msg += `<code>${prefixSymbol} ${escapeHtml(c.name)} (${stateText} · ${healthText} ${healthEmoji})</code>\n`;
      }
    }

    msg += `\n<code>└ Updated  ${this.ago(ts)}</code>`;
    return msg;
  }

  /** Container detail row for docker output */
  static containerRow(name: string, state: string, status: string): string {
    const isRunning = state.toLowerCase() === 'running';
    const isUnhealthy = status.toLowerCase().includes('unhealthy');
    let healthText = 'Healthy';
    if (!isRunning) healthText = 'Critical';
    else if (isUnhealthy) healthText = 'Unhealthy';
    return `<b>${escapeHtml(name)}</b>\n${isRunning ? 'Running' : 'Stopped'} · Health: ${healthText}`;
  }

  /** Compact empty/no-data placeholder */
  static emptyCard(alias: string): string {
    let msg = `<b>Infrastructure Report</b>\n`;
    msg += `<code>┌ Server   ${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Status   Offline 🔴</code>\n`;
    msg += `<code>├ Health   Critical 🔴</code>\n`;
    msg += `<code>└ Updated  Never</code>`;
    return msg;
  }

  /** No data summary card */
  static noDataCard(alias: string): string {
    let msg = `<b>Infrastructure Report</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `<b>Status</b>  <code>Offline</code>\n`;
    msg += `<b>Health</b>  <code>Critical 🔴</code>\n`;
    msg += `<b>Last Report</b>  <code>Never</code>`;
    return msg;
  }

  /** /health dashboard */
  static healthDashboard(kvStatus: string, providers: string, _region: string,
    _env: string, users: number, lastReportText: string
  ): string {
    const isOperational = kvStatus === 'Bound';
    const statusText = isOperational ? 'Operational' : 'Degraded';
    const statusEmoji = isOperational ? '🟢' : '🔴';

    let msg = `<b>Control Plane</b>\n\n`;
    msg += `<b>Status</b>  <code>${statusText} ${statusEmoji}</code>\n`;
    msg += `<b>Cloud Providers</b>  <code>${providers}</code>\n`;
    msg += `<b>Monitoring</b>  <code>${isOperational ? 'Receiving Telemetry 🟢' : 'Disconnected 🔴'}</code>\n`;
    msg += `<b>Runtime</b>  <code>Cloudflare Workers</code>\n`;
    msg += `<b>Authorized Operators</b>  <code>${users}</code>\n`;
    msg += `<b>Last Telemetry</b>  <code>${lastReportText}</code>`;
    return msg;
  }

  // ── Existing methods (redesigned) ─────────────────────────

  static success(action: string, target: string, extra?: Record<string, string>): string {
    let msg = `<b>✅ Operation Completed</b>\n\n`;
    msg += `<b>Action</b>  <code>${escapeHtml(action)}</code>\n`;
    msg += `<b>Target</b>  <code>${escapeHtml(target)}</code>\n`;
    if (extra) {
      msg += '\n';
      for (const [k, v] of Object.entries(extra)) {
        msg += `<b>${escapeHtml(k)}</b>  <code>${escapeHtml(v)}</code>\n`;
      }
    }
    return msg;
  }

  static status(fields: Record<string, string>): string {
    let msg = `<b>Server Status</b>\n\n`;
    for (const [k, v] of Object.entries(fields)) {
      msg += `<b>${escapeHtml(k)}</b>  <code>${escapeHtml(v)}</code>\n`;
    }
    return msg;
  }

  static monitoringReport(date: string, fields: Record<string, string>): string {
    let msg = `<b>📊 Daily Report</b>\n\n`;
    msg += `<b>Date</b>  <code>${escapeHtml(date)}</code>\n\n`;
    for (const [k, v] of Object.entries(fields)) {
      msg += `<b>${escapeHtml(k)}</b>  <code>${escapeHtml(v)}</code>\n`;
    }
    return msg;
  }

  static error(action: string, target: string, reason: string, reference?: string): string {
    let cleanReason = reason;
    if (reason.toLowerCase().includes('error:') || reason.toLowerCase().includes('exception:') || reason.includes('at ')) {
      cleanReason = 'An internal system error occurred.';
    }

    let msg = `<b>❌ Operation Failed</b>\n\n`;
    msg += `<b>Action</b>  <code>${escapeHtml(action)}</code>\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(target)}</code>\n`;
    msg += `<b>Reason</b>  <code>${escapeHtml(cleanReason)}</code>`;

    if (reference) {
      msg += `\n\n<b>Usage</b>\n<code>${escapeHtml(reference)}</code>`;
    }
    return msg;
  }

  static generalError(reason: string): string {
    let cleanReason = reason;
    if (reason.toLowerCase().includes('error:') || reason.toLowerCase().includes('exception:') || reason.includes('at ')) {
      cleanReason = 'An internal system error occurred.';
    }
    return `<b>❌ Operation Failed</b>\n\n<b>Reason</b>\n<code>${escapeHtml(cleanReason)}</code>`;
  }

  static commandOutput(lines: string[]): string {
    return lines.map((l) => escapeHtml(l)).join('\n');
  }

  static warning(title: string, reason: string, extra?: Record<string, string>): string {
    let msg = `<b>⚠️ Warning</b>\n\n`;
    msg += `<b>Subject</b>  <code>${escapeHtml(title)}</code>\n`;
    msg += `<b>Details</b>  <code>${escapeHtml(reason)}</code>\n`;
    if (extra) {
      msg += '\n';
      for (const [k, v] of Object.entries(extra)) {
        msg += `<b>${escapeHtml(k)}</b>  <code>${escapeHtml(v)}</code>\n`;
      }
    }
    return msg;
  }

  static serverMetrics(alias: string, fields: Record<string, string>): string {
    let msg = `<b>Metrics: ${escapeHtml(alias)}</b>\n\n`;
    for (const [k, v] of Object.entries(fields)) {
      msg += `<b>${escapeHtml(k)}</b>  <code>${escapeHtml(v)}</code>\n`;
    }
    return msg;
  }

  static multiline(label: string, value: string): string {
    return `<b>${escapeHtml(label)}</b>\n<code>${escapeHtml(value)}</code>\n`;
  }

  static help(commands: Array<{ command: string; description: string; args?: string }>): string {
    let msg = `<b>🚀 Infra-Bot Control Console</b>\n\n`;
    msg += `<b>Commands</b>\n`;
    for (const c of commands) {
      const cmdLine = c.args ? `${c.command} ${c.args}` : c.command;
      msg += `<code>${escapeHtml(cmdLine)}</code> · ${escapeHtml(c.description)}\n`;
    }
    return msg;
  }

  static notFound(alias: string): string {
    return this.generalError(`Server "${alias}" not found in registry.`);
  }

  static rateLimit(): string {
    let msg = `<b>⏳ Rate Limit</b>\n\n`;
    msg += `Maximum 10 commands per minute. Please wait.`;
    return msg;
  }

  static unknownCommand(command: string): string {
    let msg = `<b>❌ Unknown Command</b>\n\n`;
    msg += `<b>Command</b>  <code>${escapeHtml(command)}</code>\n`;
    msg += `Use /help to view available commands.`;
    return msg;
  }

  static configError(binding: string): string {
    let msg = `<b>❌ Config Error</b>\n\n`;
    msg += `<b>Binding</b>  <code>${escapeHtml(binding)}</code>\n`;
    msg += `Required KV binding is not configured. See /docs.`;
    return msg;
  }

  static noServers(): string {
    return this.generalError('No servers configured in registry.');
  }

  static providerStatus(alias: string, status: string, ip: string, id: string, region: string, errorMsg?: string): string {
    const isRunning = status.toLowerCase() === 'running';
    const isError = status.toLowerCase() === 'error';

    let overallHealth = 'Healthy';
    let healthEmoji = '🟢';
    if (isError) {
      overallHealth = 'Critical';
      healthEmoji = '🔴';
    } else if (!isRunning) {
      overallHealth = 'Warning';
      healthEmoji = '🟡';
    }

    let msg = `<b>Infrastructure Status Report</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `<b>Status</b>  <code>${escapeHtml(status)}</code>\n`;
    msg += `<b>Health</b>  <code>${overallHealth} ${healthEmoji}</code>\n\n`;

    msg += `<b>Detailed Information</b>\n`;
    msg += `IP Address · <code>${escapeHtml(ip)}</code>\n`;
    msg += `Instance ID · <code>${escapeHtml(id)}</code>\n`;
    msg += `Region · <code>${escapeHtml(region)}</code>`;

    if (isError && errorMsg) {
      msg += `\n\n<b>Operational Status</b>\n<code>${escapeHtml(errorMsg)}</code>`;
    }
    return msg;
  }

  static serverDetails(alias: string, provider: string, fields: Record<string, string>): string {
    const statusVal = fields['Status'] || 'Unknown';
    const isRunning = statusVal.toLowerCase() === 'running';

    let overallHealth = 'Healthy';
    let healthEmoji = '🟢';
    if (statusVal.toLowerCase() === 'error' || statusVal.toLowerCase() === 'stopped') {
      overallHealth = 'Critical';
      healthEmoji = '🔴';
    } else if (!isRunning) {
      overallHealth = 'Warning';
      healthEmoji = '🟡';
    }

    let msg = `<b>Server Details</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `<b>Status</b>  <code>${escapeHtml(statusVal)}</code>\n`;
    msg += `<b>Health</b>  <code>${overallHealth} ${healthEmoji}</code>\n\n`;

    msg += `<b>Detailed Information</b>\n`;
    msg += `Provider · <code>${escapeHtml(provider)}</code>\n`;
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'Status') continue;
      msg += `${escapeHtml(k)} · <code>${escapeHtml(v)}</code>\n`;
    }
    return msg;
  }

  static operationStatus(action: string, target: string, provider: string, status: string): string {
    let msg = `<b>✅ Operation Completed</b>\n\n`;
    msg += `<b>Action</b>  <code>${escapeHtml(action)}</code>\n`;
    msg += `<b>Target</b>  <code>${escapeHtml(target)}</code>\n`;
    msg += `<b>Provider</b>  <code>${escapeHtml(provider)}</code>\n`;
    msg += `<b>Status</b>  <code>${escapeHtml(status)}</code>\n`;
    return msg;
  }

  static warningAlert(alias: string, metric: string, current: string, threshold: string): string {
    let msg = `<b>⚠️ Alert</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `<b>Metric</b>  <code>${escapeHtml(metric)}</code>\n`;
    msg += `<b>Current</b>  <code>${escapeHtml(current)}</code>\n`;
    msg += `<b>Threshold</b>  <code>${escapeHtml(threshold)}</code>\n`;
    return msg;
  }
}
