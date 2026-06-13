import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class StatusHandler implements CommandHandler {
  public readonly name = 'status';
  public readonly description =
    'Lists status of all registered servers or queries details for a specific server';

  public async execute(ctx: TelegramContext): Promise<void> {
    if (ctx.args.length >= 1) {
      const alias = ctx.args[0];
      const server = ctx.serverRegistry.getServer(alias);

      if (!server) {
        await ctx.reply(MessageRenderer.notFound(alias), 'HTML');
        return;
      }

      const provider = ctx.providerRegistry.getProvider(server.provider);
      const [status, meta] = await Promise.all([
        provider.getServerStatus(server.id, server.region),
        provider.getInstanceMetadata(server.id, server.region),
      ]);

      await ctx.reply(
        MessageRenderer.serverDetails(alias, provider.name, {
          'Instance ID': meta.instanceId,
          'Instance Type': meta.instanceType,
          'Region': meta.availabilityZone ? meta.availabilityZone.slice(0, -1) : (server.region || 'N/A'),
          'Availability Zone': meta.availabilityZone || 'N/A',
          'Status': status.status,
          'State': meta.state,
          'Public IP': meta.publicIp || 'N/A',
          'Private IP': meta.privateIp || 'N/A',
        }),
        'HTML',
      );
      return;
    }

    const allServers = ctx.serverRegistry.getAllServers();
    if (allServers.length === 0) {
      await ctx.reply(MessageRenderer.noServers(), 'HTML');
      return;
    }

    await ctx.reply(MessageRenderer.header('Querying server status...'), 'HTML');

    const results = await Promise.all(
      allServers.map(async (server) => {
        try {
          const provider = ctx.providerRegistry.getProvider(server.provider);
          const status = await provider.getServerStatus(server.id, server.region);
          return { alias: server.alias, success: true, status };
        } catch (err) {
          return { alias: server.alias, success: false, error: err };
        }
      }),
    );

    const cards: string[] = [];

    for (const res of results) {
      if (!res.success) {
        cards.push(MessageRenderer.providerStatus(res.alias, 'Error', 'N/A', 'N/A', 'N/A', (res.error as Error).message));
        continue;
      }

      const s = res.status!;
      cards.push(MessageRenderer.providerStatus(
        res.alias,
        s.status,
        s.ipAddress || 'N/A',
        s.id,
        s.region,
      ));
    }

    await ctx.reply(cards.join('\n\n───\n\n'), 'HTML');
  }
}
