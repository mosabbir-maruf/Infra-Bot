import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';
import { ProviderRegistry } from '../../providers/ProviderRegistry';

export class HealthHandler implements CommandHandler {
  public readonly name = 'health';
  public readonly description = 'Checks Control Plane telemetry and configured providers';

  public async execute(ctx: TelegramContext): Promise<void> {
    const registry = new ProviderRegistry(ctx.env);
    const activeProviders = registry.getActiveProviders().map((p) => p.name);

    const kv = ctx.monitoringKv;
    const kvStatus = kv ? 'Bound' : 'Not Bound';

    let report = MessageRenderer.header('Control Plane Health');
    report += '\n';
    report += MessageRenderer.line('Status', 'Active');
    report += MessageRenderer.line('Environment', ctx.env.NODE_ENV);
    report += MessageRenderer.line('Default Region', ctx.env.AWS_REGION);
    report += MessageRenderer.line(
      'Active Providers',
      activeProviders.length > 0 ? activeProviders.join(', ') : 'None',
    );
    report += MessageRenderer.line('Monitoring KV', kvStatus);
    report += MessageRenderer.line(
      'Authorized Users',
      `${ctx.env.AUTHORIZED_USER_IDS.length} user(s)`,
    );
    report += MessageRenderer.line('Platform', 'Cloudflare Workers');

    await ctx.reply(report, 'HTML');
  }
}
