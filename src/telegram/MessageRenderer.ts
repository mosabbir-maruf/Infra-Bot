function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class MessageRenderer {
  static header(text: string): string {
    return `<b>${escapeHtml(text)}</b>\n`;
  }

  static line(label: string, value: string): string {
    return `<b>${escapeHtml(label)}:</b> <code>${escapeHtml(value)}</code>\n`;
  }

  static multiline(label: string, value: string): string {
    return `<b>${escapeHtml(label)}:</b>\n<code>${escapeHtml(value)}</code>\n`;
  }

  static raw(text: string): string {
    return escapeHtml(text);
  }

  static success(action: string, target: string, extra?: Record<string, string>): string {
    let msg = this.header('Operation Completed');
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

  static monitoringReport(reportDate: string, fields: Record<string, string>): string {
    let msg = this.header('Daily Infrastructure Report');
    msg += `\n${this.line('Date', reportDate)}\n`;
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
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

  static warning(title: string, reason: string, extra?: Record<string, string>): string {
    let msg = this.header('Warning');
    msg += `\n${this.line('Subject', title)}\n`;
    msg += this.multiline('Details', reason);
    if (extra) {
      msg += '\n';
      for (const [k, v] of Object.entries(extra)) {
        msg += this.line(k, v);
      }
    }
    return msg;
  }

  static error(action: string, target: string, reason: string, reference?: string): string {
    let msg = this.header('Operation Failed');
    msg += `\n${this.line('Action', action)}`;
    msg += this.line('Target', target);
    msg += `\n${this.multiline('Reason', reason)}`;
    if (reference) {
      msg += this.line('Reference', reference);
    }
    return msg;
  }

  static generalError(reason: string): string {
    let msg = this.header('Error');
    msg += `\n${this.multiline('Reason', reason)}`;
    return msg;
  }

  static commandOutput(lines: string[]): string {
    return lines.map((l) => escapeHtml(l)).join('\n');
  }

  static help(commands: Array<{ command: string; description: string; args?: string }>): string {
    let msg = this.header('Infrastructure Bot');
    msg += `\n${this.header('Available Commands')}\n`;
    for (const c of commands) {
      const cmdLine = c.args ? `${c.command} ${c.args}` : c.command;
      msg += `\n<code>${escapeHtml(cmdLine)}</code>\n${escapeHtml(c.description)}\n`;
    }
    return msg;
  }

  static notFound(alias: string): string {
    let msg = this.header('Operation Failed');
    msg += `\n${this.line('Reason', `Server "${alias}" not found in registry.`)}`;
    return msg;
  }

  static rateLimit(): string {
    let msg = this.header('Rate Limit Exceeded');
    msg += `\n${escapeHtml('Maximum rate of 10 commands per minute reached. Please wait before sending another command.')}`;
    return msg;
  }

  static unknownCommand(command: string): string {
    let msg = this.header('Unknown Command');
    msg += `\n${this.line('Command', command)}`;
    msg += `\n${escapeHtml('Use /help to view available commands.')}`;
    return msg;
  }

  static configError(binding: string): string {
    let msg = this.header('Configuration Error');
    msg += `\n${this.line('Binding', binding)}`;
    msg += `\n${escapeHtml('The required Cloudflare KV binding is not configured. Contact your administrator.')}`;
    return msg;
  }

  static noServers(): string {
    let msg = this.header('No Servers Registered');
    msg += `\n${escapeHtml('No servers are configured in the registry.')}`;
    return msg;
  }

  static providerStatus(alias: string, status: string, ip: string, id: string, region: string): string {
    let msg = this.header(`Server Status: ${alias}`);
    msg += '\n';
    msg += this.line('Status', status);
    msg += this.line('IP Address', ip || 'N/A');
    msg += this.line('Instance ID', id);
    msg += this.line('Region', region);
    return msg;
  }

  static serverDetails(alias: string, provider: string, fields: Record<string, string>): string {
    let msg = this.header(`Server Details: ${alias}`);
    msg += `\n${this.line('Provider', provider)}`;
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
    }
    return msg;
  }

  static operationStatus(action: string, target: string, provider: string, status: string): string {
    let msg = this.header('Operation Completed');
    msg += `\n${this.line('Action', action)}`;
    msg += this.line('Target', target);
    msg += this.line('Provider', provider);
    msg += this.line('Status', status);
    return msg;
  }

  static warningAlert(alias: string, metric: string, current: string, threshold: string): string {
    let msg = this.header('Warning');
    msg += `\n${this.line('Server', alias)}`;
    msg += this.line('Metric', metric);
    msg += this.line('Current', current);
    msg += this.line('Threshold', threshold);
    return msg;
  }
}
