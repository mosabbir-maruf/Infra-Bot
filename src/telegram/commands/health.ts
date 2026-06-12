import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { ProviderRegistry } from '../../providers/ProviderRegistry';

export class HealthHandler implements CommandHandler {
  public readonly name = 'health';
  public readonly description = 'Checks Control Plane telemetry and configured providers';

  public async execute(ctx: TelegramContext): Promise<void> {
    const registry = new ProviderRegistry(ctx.env);
    const activeProviders = registry.getActiveProviders().map((p) => p.name);

    const kv = (ctx.env as unknown as Record<string, unknown>).MONITORING_KV;
    const kvStatus = kv ? 'Bound 🟢' : 'Missing ⚠️';

    const report = `⚙️ <b>Control Plane Health Summary</b>

• <b>Status:</b> Active 🟢
• <b>Node Env:</b> <code>${ctx.env.NODE_ENV}</code>
• <b>Default AWS Region:</b> <code>${ctx.env.AWS_REGION}</code>
• <b>Active Provider Bindings:</b> ${activeProviders.length > 0 ? activeProviders.join(', ') : 'None ⚠️'}
• <b>Monitoring KV Status:</b> <code>${kvStatus}</code>
• <b>Authorized Whitelist:</b> <code>${ctx.env.AUTHORIZED_USER_IDS.length} user(s)</code>
• <b>Deployment Platform:</b> Cloudflare Workers (Edge Engine)`;

    await ctx.reply(report, 'HTML');
  }
}
