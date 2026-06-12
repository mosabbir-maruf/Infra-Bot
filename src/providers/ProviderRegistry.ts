import { CloudProvider } from '../core/providers/Provider';
import { Env } from '../config/Env';
import { AWSProvider } from './AWSProvider';
import { DigitalOceanProvider } from './DigitalOceanProvider';
import { Logger } from '../utils/Logger';

export class ProviderRegistry {
  private readonly providers = new Map<string, CloudProvider>();

  constructor(env: Env) {
    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      try {
        this.providers.set('aws', new AWSProvider(env));
        Logger.info('ProviderRegistry: Registered AWS provider.');
      } catch (err) {
        Logger.error('ProviderRegistry: Failed to register AWS provider.', err);
      }
    } else {
      Logger.warn('ProviderRegistry: AWS credentials not configured. Skipping AWS registration.');
    }

    if (env.DIGITALOCEAN_TOKEN) {
      try {
        const doProvider = new DigitalOceanProvider(env);
        this.providers.set('digitalocean', doProvider);
        this.providers.set('do', doProvider); // Alias for brevity
        Logger.info('ProviderRegistry: Registered DigitalOcean provider.');
      } catch (err) {
        Logger.error('ProviderRegistry: Failed to register DigitalOcean provider.', err);
      }
    } else {
      Logger.warn(
        'ProviderRegistry: DigitalOcean token not configured. Skipping DigitalOcean registration.',
      );
    }
  }

  /**
   * Retrieves a CloudProvider by its name (case insensitive, matches 'aws', 'digitalocean', 'do')
   */
  public getProvider(name: string): CloudProvider {
    const provider = this.providers.get(name.toLowerCase());
    if (!provider) {
      throw new Error(
        `Cloud provider "${name}" is either unsupported or not configured in environment bindings.`,
      );
    }
    return provider;
  }

  /**
   * Returns a list of all active registered CloudProviders
   */
  public getActiveProviders(): CloudProvider[] {
    const unique = new Set(this.providers.values());
    return Array.from(unique);
  }
}
