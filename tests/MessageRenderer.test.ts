import { describe, it, expect } from 'vitest';
import { MessageRenderer } from '../src/telegram/MessageRenderer';

describe('MessageRenderer', () => {
  describe('header', () => {
    it('renders bold header', () => {
      expect(MessageRenderer.header('Test')).toBe('<b>Test</b>\n');
    });

    it('escapes HTML in header', () => {
      expect(MessageRenderer.header('<script>')).toBe('<b>&lt;script&gt;</b>\n');
    });
  });

  describe('line', () => {
    it('renders label and value', () => {
      expect(MessageRenderer.line('Action', 'Reboot')).toBe(
        '<b>Action:</b> <code>Reboot</code>\n',
      );
    });

    it('escapes HTML in label and value', () => {
      expect(MessageRenderer.line('<a>', '<b>')).toBe(
        '<b>&lt;a&gt;:</b> <code>&lt;b&gt;</code>\n',
      );
    });
  });

  describe('multiline', () => {
    it('renders label with multiline value', () => {
      expect(MessageRenderer.multiline('Reason', 'line1\nline2')).toBe(
        '<b>Reason:</b>\n<code>line1\nline2</code>\n',
      );
    });
  });

  describe('success', () => {
    it('renders success message with action and target', () => {
      const result = MessageRenderer.success('Reboot', 'server-01');
      expect(result).toContain('<b>Operation Completed</b>');
      expect(result).toContain('<b>Action:</b> <code>Reboot</code>');
      expect(result).toContain('<b>Target:</b> <code>server-01</code>');
    });

    it('renders success message with extra fields', () => {
      const result = MessageRenderer.success('Start', 'server-01', {
        Provider: 'AWS',
        Status: 'Accepted',
      });
      expect(result).toContain('<b>Provider:</b> <code>AWS</code>');
      expect(result).toContain('<b>Status:</b> <code>Accepted</code>');
    });
  });

  describe('status', () => {
    it('renders status message', () => {
      const result = MessageRenderer.status({
        'Alias': 'server-01',
        'Provider': 'AWS',
        'Status': 'Running',
      });
      expect(result).toContain('<b>Server Status</b>');
      expect(result).toContain('<b>Alias:</b> <code>server-01</code>');
      expect(result).toContain('<b>Status:</b> <code>Running</code>');
    });
  });

  describe('error', () => {
    it('renders error message with reason', () => {
      const result = MessageRenderer.error('Status', 'server-01', 'Connection timeout.');
      expect(result).toContain('<b>Operation Failed</b>');
      expect(result).toContain('<b>Action:</b> <code>Status</code>');
      expect(result).toContain('<b>Target:</b> <code>server-01</code>');
      expect(result).toContain('<b>Reason:</b>');
      expect(result).toContain('<code>Connection timeout.</code>');
    });

    it('renders error message with reference', () => {
      const result = MessageRenderer.error(
        'Status',
        'server-01',
        'API error.',
        'ref-123',
      );
      expect(result).toContain('<b>Reference:</b> <code>ref-123</code>');
    });
  });

  describe('warning', () => {
    it('renders warning message', () => {
      const result = MessageRenderer.warning(
        'Bandwidth',
        'Usage exceeded 80 GB.',
      );
      expect(result).toContain('<b>Warning</b>');
      expect(result).toContain('<b>Subject:</b> <code>Bandwidth</code>');
      expect(result).toContain('<b>Details:</b>');
    });

    it('renders warning with extra fields', () => {
      const result = MessageRenderer.warning(
        'SERVER-01',
        'Bandwidth threshold exceeded.',
        { 'Current Usage': '82.4 GB', 'Threshold': '80 GB' },
      );
      expect(result).toContain('<b>Current Usage:</b> <code>82.4 GB</code>');
      expect(result).toContain('<b>Threshold:</b> <code>80 GB</code>');
    });
  });

  describe('generalError', () => {
    it('renders general error', () => {
      const result = MessageRenderer.generalError('Something went wrong.');
      expect(result).toContain('<b>Error</b>');
      expect(result).toContain('<b>Reason:</b>');
      expect(result).toContain('<code>Something went wrong.</code>');
    });
  });

  describe('help', () => {
    it('renders help message with commands', () => {
      const result = MessageRenderer.help([
        { command: '/help', description: 'Show help.' },
        { command: '/status', description: 'Show status.', args: '<server>' },
      ]);
      expect(result).toContain('<b>Infrastructure Bot</b>');
      expect(result).toContain('<b>Available Commands</b>');
      expect(result).toContain('<code>/help</code>');
      expect(result).toContain('<code>/status &lt;server&gt;</code>');
      expect(result).toContain('Show help.');
      expect(result).toContain('Show status.');
    });
  });

  describe('notFound', () => {
    it('renders not found message', () => {
      const result = MessageRenderer.notFound('missing-server');
      expect(result).toContain('<b>Operation Failed</b>');
      expect(result).toContain(
        '<b>Reason:</b> <code>Server "missing-server" not found in registry.</code>',
      );
    });
  });

  describe('rateLimit', () => {
    it('renders rate limit message', () => {
      const result = MessageRenderer.rateLimit();
      expect(result).toContain('<b>Rate Limit Exceeded</b>');
      expect(result).toContain('10 commands per minute');
    });
  });

  describe('unknownCommand', () => {
    it('renders unknown command message', () => {
      const result = MessageRenderer.unknownCommand('/badcmd');
      expect(result).toContain('<b>Unknown Command</b>');
      expect(result).toContain('<b>Command:</b> <code>/badcmd</code>');
    });
  });

  describe('configError', () => {
    it('renders config error message', () => {
      const result = MessageRenderer.configError('MONITORING_KV');
      expect(result).toContain('<b>Configuration Error</b>');
      expect(result).toContain('<b>Binding:</b> <code>MONITORING_KV</code>');
    });
  });

  describe('operationStatus', () => {
    it('renders operation status message', () => {
      const result = MessageRenderer.operationStatus(
        'Reboot',
        'server-01',
        'AWS',
        'Accepted',
      );
      expect(result).toContain('<b>Operation Completed</b>');
      expect(result).toContain('<b>Action:</b> <code>Reboot</code>');
      expect(result).toContain('<b>Target:</b> <code>server-01</code>');
      expect(result).toContain('<b>Provider:</b> <code>AWS</code>');
      expect(result).toContain('<b>Status:</b> <code>Accepted</code>');
    });
  });

  describe('noServers', () => {
    it('renders no servers message', () => {
      const result = MessageRenderer.noServers();
      expect(result).toContain('<b>No Servers Registered</b>');
    });
  });

  describe('warningAlert', () => {
    it('renders warning alert message', () => {
      const result = MessageRenderer.warningAlert(
        'server-01',
        'Bandwidth',
        '82.4 GB',
        '80 GB',
      );
      expect(result).toContain('<b>Warning</b>');
      expect(result).toContain('<b>Server:</b> <code>server-01</code>');
      expect(result).toContain('<b>Metric:</b> <code>Bandwidth</code>');
      expect(result).toContain('<b>Current:</b> <code>82.4 GB</code>');
      expect(result).toContain('<b>Threshold:</b> <code>80 GB</code>');
    });
  });

  describe('providerStatus', () => {
    it('renders provider status message', () => {
      const result = MessageRenderer.providerStatus(
        'server-01',
        'Running',
        '10.0.0.1',
        'i-1234',
        'us-east-1',
      );
      expect(result).toContain('<b>Server Status: server-01</b>');
      expect(result).toContain('<b>Status:</b> <code>Running</code>');
      expect(result).toContain('<b>IP Address:</b> <code>10.0.0.1</code>');
      expect(result).toContain('<b>Instance ID:</b> <code>i-1234</code>');
      expect(result).toContain('<b>Region:</b> <code>us-east-1</code>');
    });
  });

  describe('serverDetails', () => {
    it('renders server details message', () => {
      const result = MessageRenderer.serverDetails('server-01', 'AWS', {
        'Instance Type': 't3.medium',
        'Status': 'running',
        'Public IP': '1.2.3.4',
      });
      expect(result).toContain('<b>Server Details: server-01</b>');
      expect(result).toContain('<b>Provider:</b> <code>AWS</code>');
      expect(result).toContain('<b>Instance Type:</b> <code>t3.medium</code>');
    });
  });

  describe('serverMetrics', () => {
    it('renders metrics message', () => {
      const result = MessageRenderer.serverMetrics('server-01', {
        'CPU': '12%',
        'RAM': '4.2 GB / 8.0 GB',
      });
      expect(result).toContain('<b>Metrics: server-01</b>');
      expect(result).toContain('<b>CPU:</b> <code>12%</code>');
    });
  });

  describe('HTML escaping', () => {
    it('escapes HTML special characters in all parts', () => {
      const result = MessageRenderer.line('<name>', '<value>&');
      expect(result).not.toContain('<name>');
      expect(result).not.toContain('<value>');
      expect(result).toContain('&lt;name&gt;');
      expect(result).toContain('&lt;value&gt;&amp;');
    });

    it('escapes HTML in dynamic server names', () => {
      const result = MessageRenderer.notFound('<script>alert("xss")</script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });
  });
});
