import { describe, it, expect } from 'vitest';
import { MessageRenderer } from '../src/telegram/MessageRenderer';

describe('MessageRenderer', () => {
  describe('bar', () => {
    it('renders full bar at 100%', () => {
      expect(MessageRenderer.bar(100, 5)).toBe('█████');
    });
    it('renders empty bar at 0%', () => {
      expect(MessageRenderer.bar(0, 5)).toBe('░░░░░');
    });
    it('renders partial bar', () => {
      expect(MessageRenderer.bar(50, 10)).toBe('█████░░░░░');
    });
  });

  describe('duration', () => {
    it('formats seconds to Xh Ym', () => {
      const r = MessageRenderer.duration(3723);
      expect(r).toContain('1h');
    });
    it('formats days', () => {
      expect(MessageRenderer.duration(90000)).toBe('1d 1h');
    });
  });

  describe('ago', () => {
    it('returns "just now" for recent timestamps', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(MessageRenderer.ago(now)).toBe('just now');
    });
    it('returns minutes ago', () => {
      const fiveMin = Math.floor(Date.now() / 1000) - 300;
      expect(MessageRenderer.ago(fiveMin)).toContain('m ago');
    });
  });

  describe('healthIcon', () => {
    it('critical at 90+', () => { expect(MessageRenderer.healthIcon(90)).toBe('🔴'); });
    it('warning at 70-89', () => { expect(MessageRenderer.healthIcon(75)).toBe('🟡'); });
    it('healthy below 70', () => { expect(MessageRenderer.healthIcon(50)).toBe('🟢'); });
  });

  describe('reportCard', () => {
    it('renders full report card with inline key-value and code tags', () => {
      const r = MessageRenderer.reportCard(
        'server-01', Date.now() / 1000, '12.5', 12.5, 4096, 8192, 20480, 51200, 360000, 3, 5, 0,
      );
      expect(r).toContain('Infrastructure Report');
      expect(r).toContain('┌ Server   server-01');
      expect(r).toContain('CPU      [');
      expect(r).toContain('13%');
      expect(r).toContain('50%');
      expect(r).toContain('40%');
      expect(r).toContain('Running  3/5');
    });
    it('shows reason when unhealthy containers present', () => {
      const r = MessageRenderer.reportCard(
        'server-01', Date.now() / 1000, '5', 5, 4096, 8192, 20480, 51200, 360000, 3, 5, 1,
      );
      expect(r).toContain('└ Reason   2 stopped svc, 1 unhealthy svc');
      expect(r).toContain('1 Unhealthy 🔴');
    });
  });

  describe('uptimeCard', () => {
    it('renders uptime card with inline format', () => {
      const r = MessageRenderer.uptimeCard('node', Date.now() / 1000, 86400, 'Healthy');
      expect(r).toContain('System Uptime');
      expect(r).toContain('┌ Server   node');
      expect(r).toContain('├ Uptime   1d 0h');
      expect(r).toContain('├ Health   Healthy 🟢');
    });
  });

  describe('bandwidthCard', () => {
    it('renders bandwidth card with dot separators and code tags', () => {
      const r = MessageRenderer.bandwidthCard('gw', Date.now() / 1000, 10737418240, 5368709120, 100);
      expect(r).toContain('Bandwidth Usage');
      expect(r).toContain('┌ Server   gw');
      expect(r).toContain('├ Download 10.00 GB');
      expect(r).toContain('├ Upload   5.00 GB');
      expect(r).toContain('└ Total    15.00 GB');
      expect(r).toContain('Quota Limit');
    });
    it('shows 0% usage when no bandwidth limit', () => {
      const r = MessageRenderer.bandwidthCard('gw', Date.now() / 1000, 0, 0);
      expect(r).toContain('Total    0.00 GB');
    });
  });

  describe('dockerCard', () => {
    it('renders docker card with summary dot separators', () => {
      const r = MessageRenderer.dockerCard('node', 3, 5, 0, [
        { name: 'nginx', status: 'Up 2 days', state: 'running' },
        { name: 'api', status: 'Exited', state: 'exited' },
      ], Date.now() / 1000);
      expect(r).toContain('Container Status');
      expect(r).toContain('├ Running  3/5');
      expect(r).toContain('├ Healthy  3');
      expect(r).toContain('└ Issues   2 🔴');
      expect(r).toContain('Affected Services');
      expect(r).toContain('api');
      // nginx is healthy and running, should NOT be in affected
      expect(r).not.toContain('nginx (');
    });
    it('shows unhealthy containers as affected services', () => {
      const r = MessageRenderer.dockerCard('node', 3, 3, 1, [
        { name: 'web', status: 'Up 1 hour (unhealthy)', state: 'running' },
      ], Date.now() / 1000);
      expect(r).toContain('Affected Services');
      expect(r).toContain('web (');
      expect(r).toContain('Unhealthy 🔴');
    });
  });

  describe('emptyCard', () => {
    it('renders empty placeholder with code tags', () => {
      const r = MessageRenderer.emptyCard('missing');
      expect(r).toContain('┌ Server   missing');
      expect(r).toContain('├ Health   Critical 🔴');
    });
  });

  describe('healthDashboard', () => {
    it('renders control plane with inline code tag format', () => {
      const r = MessageRenderer.healthDashboard('Bound', 'AWS', 'us-east-1', 'production', 2, '2m ago');
      expect(r).toContain('Control Plane');
      expect(r).toContain('<b>Status</b>  <code>Operational 🟢</code>');
      expect(r).toContain('<b>Cloud Providers</b>  <code>AWS</code>');
      expect(r).toContain('<code>Receiving Telemetry 🟢</code>');
      expect(r).toContain('<code>Cloudflare Workers</code>');
      expect(r).toContain('<b>Authorized Operators</b>  <code>2</code>');
      expect(r).toContain('<b>Last Telemetry</b>  <code>2m ago</code>');
    });
  });

  describe('legacy methods', () => {
    it('success renders with emoji', () => {
      expect(MessageRenderer.success('Reboot', 'srv').replace(/^\uFEFF/, '')).toContain('Operation Completed');
    });
    it('error renders with emoji', () => {
      expect(MessageRenderer.error('Stop', 'srv', 'timeout').replace(/^\uFEFF/, '')).toContain('Operation Failed');
    });
    it('warning renders with emoji', () => {
      expect(MessageRenderer.warning('Disk', 'full', { Used: '90%' })).toContain('Warning');
    });
    it('help renders with emoji', () => {
      expect(MessageRenderer.help([{ command: '/help', description: 'Help' }])).toContain('Infra-Bot');
    });
    it('notFound returns general error', () => {
      expect(MessageRenderer.notFound('x')).toContain('Operation Failed');
    });
    it('rateLimit renders compact', () => {
      expect(MessageRenderer.rateLimit()).toContain('Rate Limit');
      expect(MessageRenderer.rateLimit()).toContain('10 commands');
    });
    it('configError renders compact', () => {
      expect(MessageRenderer.configError('KV')).toContain('Config Error');
    });
    it('success with extra fields', () => {
      const r = MessageRenderer.success('Start', 'svr', { Provider: 'AWS' });
      expect(r).toContain('Provider');
      expect(r).toContain('AWS');
    });
    it('line renders label and value', () => {
      expect(MessageRenderer.line('Key', 'Val')).toContain('Key');
      expect(MessageRenderer.line('Key', 'Val')).toContain('Val');
    });
    it('HTML escaping', () => {
      const r = MessageRenderer.line('<script>', '&amp;');
      expect(r).toContain('&lt;script&gt;');
      expect(r).toContain('&amp;amp;');
    });
    it('warningAlert renders compact', () => {
      const r = MessageRenderer.warningAlert('svr', 'BW', '90GB', '80GB');
      expect(r).toContain('Alert');
    });
    it('providerStatus renders server info', () => {
      const r = MessageRenderer.providerStatus('svr', 'running', '1.2.3.4', 'i-123', 'us-east-1');
      expect(r).toContain('Infrastructure Status Report');
      expect(r).toContain('svr');
      expect(r).toContain('running');
    });
    it('serverDetails renders with provider', () => {
      const r = MessageRenderer.serverDetails('svr', 'AWS', { Status: 'running', Type: 't3' });
      expect(r).toContain('Server Details');
      expect(r).toContain('svr');
      expect(r).toContain('AWS');
    });
    it('operationStatus renders compact', () => {
      const r = MessageRenderer.operationStatus('Reboot', 'svr', 'AWS', 'Accepted');
      expect(r).toContain('Operation Completed');
    });
    it('generalError renders compact', () => {
      expect(MessageRenderer.generalError('fail').replace(/^\uFEFF/, '')).toContain('Operation Failed');
      expect(MessageRenderer.generalError('fail')).toContain('fail');
    });
  });
});
