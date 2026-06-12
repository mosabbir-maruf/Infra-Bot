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
    if (healthList.includes('Critical')) {
      overallHealth = 'Critical';
    } else if (healthList.includes('Warning')) {
      overallHealth = 'Warning';
    }

    const reasons: string[] = [];
    if (cpuHealth !== 'Healthy') reasons.push(`CPU usage ${cpuHealth.toLowerCase()}`);
    if (ramHealth !== 'Healthy') reasons.push(`Memory usage ${ramHealth.toLowerCase()}`);
    if (diskHealth !== 'Healthy') reasons.push(`Disk usage ${diskHealth.toLowerCase()}`);
    if (freshnessHealth !== 'Healthy') {
      reasons.push(freshnessHealth === 'Critical' ? 'monitoring agent inactive' : 'monitoring agent delayed');
    }
    if (dockerTotal !== undefined && dockerTotal > 0) {
      if (dockerRunning !== undefined && dockerRunning < dockerTotal) {
        const diff = dockerTotal - dockerRunning;
        reasons.push(`${diff} stopped container${diff > 1 ? 's' : ''}`);
      }
      if (dockerUnhealthy && dockerUnhealthy > 0) {
        reasons.push(`${dockerUnhealthy} unhealthy container${dockerUnhealthy > 1 ? 's' : ''}`);
      }
    }
    const reasonText = reasons.length > 0 ? reasons.join(', ') : 'None';

    let msg = `<b>Infrastructure Report</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `<b>Health</b>  <code>${overallHealth}</code>\n`;

    if (overallHealth !== 'Healthy') {
      msg += `<b>Reason</b>  <code>${escapeHtml(reasonText)}</code>\n`;
    }

    msg += `\n<b>Resources</b>\n`;
    msg += `CPU · <code>${cpuPct.toFixed(0)}%</code>\n`;
    msg += `Memory · <code>${ramPct.toFixed(0)}%</code>\n`;
    msg += `Disk · <code>${diskPct.toFixed(0)}%</code>\n`;

    if (dockerTotal !== undefined) {
      msg += `\n<b>Containers</b>\n`;
      msg += `<code>${dockerRunning ?? 0}</code> Running`;
      if (dockerUnhealthy && dockerUnhealthy > 0) {
        msg += ` · <code>${dockerUnhealthy}</code> Unhealthy`;
      }
      msg += `\n`;
    }

    msg += `\n<b>Uptime</b>  <code>${this.duration(uptime)}</code>\n`;
    msg += `<b>Last Report</b>  <code>${this.ago(ts)}</code>`;
    return msg;
  }

  /** Compact uptime card */
  static uptimeCard(alias: string, ts: number, uptime: number, health: string): string {
    let msg = `<b>System Uptime</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `<b>Current Uptime</b>  <code>${this.duration(uptime)}</code>\n`;
    msg += `<b>System Health</b>  <code>${health}</code>\n`;
    msg += `<b>Last Report</b>  <code>${this.ago(ts)}</code>`;
    return msg;
  }

  /** Bandwidth card */
  static bandwidthCard(_alias: string, ts: number, rx: number, tx: number, limitGB?: number): string {
    const totalGB = (rx + tx) / (1024 ** 3);
    const rxGB = (rx / (1024 ** 3)).toFixed(2);
    const txGB = (tx / (1024 ** 3)).toFixed(2);

    let msg = `<b>Bandwidth Usage</b>\n\n`;
    msg += `<b>Current Month</b>\n`;
    msg += `Download · <code>${rxGB} GB</code>\n`;
    msg += `Upload · <code>${txGB} GB</code>\n`;
    msg += `Total · <code>${totalGB.toFixed(2)} GB</code>\n`;

    if (limitGB && limitGB > 0) {
      const usagePct = Math.round((totalGB / limitGB) * 100);
      msg += `Usage · <code>${usagePct}%</code>\n`;
    } else {
      msg += `Usage · <code>0%</code>\n`;
    }

    msg += `\n<b>Last Report</b>  <code>${this.ago(ts)}</code>`;
    return msg;
  }

  /** Docker containers card */
  static dockerCard(alias: string, running: number, total: number, unhealthy: number,
    containers: Array<{ name: string; status: string; state: string }>, ts: number
  ): string {
    const healthy = running - unhealthy;
    const issues = total - running + unhealthy;

    const getCleanUptime = (status: string) => {
      const normalized = status.toLowerCase();
      if (!normalized.startsWith('up ')) return 'N/A';
      let uptimeText = status.substring(3);
      const idx = uptimeText.indexOf('(');
      if (idx !== -1) uptimeText = uptimeText.substring(0, idx).trim();
      uptimeText = uptimeText
        .replace(/\bseconds?\b/g, 's')
        .replace(/\bminutes?\b/g, 'm')
        .replace(/\bhours?\b/g, 'h')
        .replace(/\bdays?\b/g, 'd')
        .replace(/\bweeks?\b/g, 'w')
        .replace(/\s+/g, '');
      return uptimeText;
    };

    let msg = `<b>Container Status</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `\n<b>Summary</b>\n`;
    msg += `Running · <code>${running}</code>\n`;
    msg += `Healthy · <code>${healthy}</code>\n`;
    msg += `Issues · <code>${issues}</code>\n`;

    // Show only affected (problematic) services
    const affectedContainers = containers.filter(c => {
      const isRunning = c.state.toLowerCase() === 'running';
      const isUnhealthy = c.status.toLowerCase().includes('unhealthy');
      return !isRunning || isUnhealthy;
    });

    if (affectedContainers.length > 0) {
      for (const c of affectedContainers) {
        const isRunning = c.state.toLowerCase() === 'running';
        const isUnhealthy = c.status.toLowerCase().includes('unhealthy');

        const stateText = isRunning ? 'Running' : 'Stopped';
        let healthText = 'Healthy';
        if (!isRunning) healthText = 'Critical';
        else if (isUnhealthy) healthText = 'Unhealthy';

        msg += `\n<b>Affected Service</b>\n`;
        msg += `<code>${escapeHtml(c.name)}</code>\n`;
        msg += `State · <code>${stateText}</code>\n`;
        msg += `Health · <code>${healthText}</code>\n`;
        msg += `Uptime · <code>${getCleanUptime(c.status)}</code>\n`;
      }
    }

    msg += `\n<b>Last Report</b>  <code>${this.ago(ts)}</code>`;
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
    let msg = `<b>Infrastructure Report</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `<b>Status</b>  <code>Offline</code>\n`;
    msg += `<b>Health</b>  <code>Critical</code>\n`;
    msg += `<b>Last Report</b>  <code>Never</code>`;
    return msg;
  }

  /** No data summary card */
  static noDataCard(alias: string): string {
    let msg = `<b>Infrastructure Report</b>\n\n`;
    msg += `<b>Server</b>  <code>${escapeHtml(alias)}</code>\n`;
    msg += `<b>Status</b>  <code>Offline</code>\n`;
    msg += `<b>Health</b>  <code>Critical</code>\n`;
    msg += `<b>Last Report</b>  <code>Never</code>`;
    return msg;
  }

  /** /health dashboard */
  static healthDashboard(kvStatus: string, providers: string, _region: string,
    _env: string, users: number, lastReportText: string
  ): string {
    const isOperational = kvStatus === 'Bound';
    const statusText = isOperational ? 'Operational' : 'Degraded';

    let msg = `<b>Control Plane</b>\n\n`;
    msg += `<b>Status</b>  <code>${statusText}</code>\n`;
    msg += `<b>Cloud Providers</b>  <code>${providers}</code>\n`;
    msg += `<b>Monitoring</b>  <code>${isOperational ? 'Receiving Telemetry' : 'Disconnected'}</code>\n`;
    msg += `<b>Runtime</b>  <code>Cloudflare Workers</code>\n`;
    msg += `<b>Authorized Operators</b>  <code>${users}</code>\n`;
    msg += `<b>Last Telemetry</b>  <code>${lastReportText}</code>`;
    return msg;
  }

  // ── Existing methods (unchanged) ─────────────────────────

  static success(action: string, target: string, extra?: Record<string, string>): string {
    let msg = this.header('✅ Operation Completed');
    msg += `\n${this.line('Action', action)}`;
    msg += this.line('Target', target);
    if (extra) {
      msg += '\n';
      for (const [k, v] of Object.entries(extra)) {
        msg += this.line(k, v);
      }
    }
    return msg;
  }

  static status(fields: Record<string, string>): string {
    let msg = this.header('Server Status');
    msg += '\n';
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
    }
    return msg;
  }

  static monitoringReport(date: string, fields: Record<string, string>): string {
    let msg = this.header('📊 Daily Report');
    msg += `\n${this.line('Date', date)}\n`;
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
    }
    return msg;
  }

  static error(action: string, target: string, reason: string, reference?: string): string {
    let cleanReason = reason;
    if (reason.toLowerCase().includes('error:') || reason.toLowerCase().includes('exception:') || reason.includes('at ')) {
      cleanReason = 'An internal system error occurred.';
    }

    let msg = `<b>Operation Failed</b>\n\n`;
    msg += `<b>Action</b>\n${escapeHtml(action)}\n\n`;
    msg += `<b>Server</b>\n${escapeHtml(target)}\n\n`;
    msg += `<b>Reason</b>\n${escapeHtml(cleanReason)}`;

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
    return `<b>Operation Failed</b>\n\n<b>Reason</b>\n${escapeHtml(cleanReason)}`;
  }

  static commandOutput(lines: string[]): string {
    return lines.map((l) => escapeHtml(l)).join('\n');
  }

  static warning(title: string, reason: string, extra?: Record<string, string>): string {
    let msg = this.header('⚠️ Warning');
    msg += `\n${this.line('Subject', title)}`;
    msg += `<b>Details:</b>\n<code>${escapeHtml(reason)}</code>\n`;
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        msg += this.line(k, v);
      }
    }
    return msg;
  }

  static serverMetrics(alias: string, fields: Record<string, string>): string {
    let msg = this.header(`Metrics: ${alias}`);
    msg += '\n';
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
    }
    return msg;
  }

  static multiline(label: string, value: string): string {
    return `<b>${escapeHtml(label)}:</b>\n<code>${escapeHtml(value)}</code>\n`;
  }

  static help(commands: Array<{ command: string; description: string; args?: string }>): string {
    let msg = this.header('🚀 Infra-Bot');
    msg += `\n<code>Commands</code>\n`;
    for (const c of commands) {
      const cmdLine = c.args ? `${c.command} ${c.args}` : c.command;
      msg += `\n<code>${escapeHtml(cmdLine)}</code>  ${escapeHtml(c.description)}`;
    }
    return msg;
  }

  static notFound(alias: string): string {
    return this.generalError(`Server "${alias}" not found in registry.`);
  }

  static rateLimit(): string {
    let msg = this.header('⏳ Rate Limit');
    msg += `\nMaximum 10 commands per minute. Please wait.`;
    return msg;
  }

  static unknownCommand(command: string): string {
    let msg = this.header('Unknown Command');
    msg += `\n${this.line('Command', command)}`;
    msg += `Use /help to view available commands.`;
    return msg;
  }

  static configError(binding: string): string {
    let msg = this.header('Config Error');
    msg += `\n${this.line('Binding', binding)}`;
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
    if (isError) {
      overallHealth = 'Critical';
    } else if (!isRunning) {
      overallHealth = 'Warning';
    }

    let msg = `<b>Infrastructure Status Report</b>\n\n`;
    msg += `<b>Server</b>\n${escapeHtml(alias)}\n\n`;
    msg += `<b>Status</b>\n${escapeHtml(status)}\n\n`;
    msg += `<b>Health</b>\n${overallHealth}\n\n`;

    msg += `<b>Detailed Information</b>\n`;
    msg += `IP Address: ${escapeHtml(ip)}\n`;
    msg += `Instance ID: ${escapeHtml(id)}\n`;
    msg += `Region: ${escapeHtml(region)}`;

    if (isError && errorMsg) {
      let cleanReason = errorMsg;
      if (errorMsg.toLowerCase().includes('error:') || errorMsg.toLowerCase().includes('exception:') || errorMsg.includes('at ')) {
        cleanReason = 'Cloud provider API or configuration error.';
      }
      msg += `\n\n<b>Operational Status</b>\n${escapeHtml(cleanReason)}`;
    }
    return msg;
  }

  static serverDetails(alias: string, provider: string, fields: Record<string, string>): string {
    const statusVal = fields['Status'] || 'Unknown';
    const isRunning = statusVal.toLowerCase() === 'running';

    let overallHealth = 'Healthy';
    if (statusVal.toLowerCase() === 'error' || statusVal.toLowerCase() === 'stopped') {
      overallHealth = 'Critical';
    } else if (!isRunning) {
      overallHealth = 'Warning';
    }

    let msg = `<b>Server Details</b>\n\n`;
    msg += `<b>Server</b>\n${escapeHtml(alias)}\n\n`;
    msg += `<b>Status</b>\n${escapeHtml(statusVal)}\n\n`;
    msg += `<b>Health</b>\n${overallHealth}\n\n`;

    msg += `<b>Detailed Information</b>\n`;
    msg += `Provider: ${escapeHtml(provider)}\n`;
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'Status') continue;
      msg += `${escapeHtml(k)}: ${escapeHtml(v)}\n`;
    }
    return msg;
  }

  static operationStatus(action: string, target: string, provider: string, status: string): string {
    let msg = this.header('✅ Operation Completed');
    msg += `\n${this.line('Action', action)}`;
    msg += this.line('Target', target);
    msg += this.line('Provider', provider);
    msg += this.line('Status', status);
    return msg;
  }

  static warningAlert(alias: string, metric: string, current: string, threshold: string): string {
    let msg = this.header('⚠️ Alert');
    msg += `\n${this.line('Server', alias)}`;
    msg += this.line('Metric', metric);
    msg += this.line('Current', current);
    msg += this.line('Threshold', threshold);
    return msg;
  }
}
