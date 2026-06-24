import { CloudProvider } from '../core/providers/Provider';
import { Env } from '../config/Env';
import { AWSProvider } from './AWSProvider';
import { AzureProvider } from './AzureProvider';
import { DigitalOceanProvider } from './DigitalOceanProvider';
import { Logger } from '../utils/Logger';

export class ProviderRegistry {
  private readonly providers = new Map<string, CloudProvider>();
  private readonly activeProviders: CloudProvider[];

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

    if (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET && env.AZURE_SUBSCRIPTION_ID) {
      try {
        this.providers.set('azure', new AzureProvider(env));
        Logger.info('ProviderRegistry: Registered Azure provider.');
      } catch (err) {
        Logger.error('ProviderRegistry: Failed to register Azure provider.', err);
      }
    } else {
      Logger.warn(
        'ProviderRegistry: Azure credentials not configured. Skipping Azure registration.',
      );
    }

    // Cache unique active providers once — avoids Set+Array.from on every getActiveProviders() call
    const unique = new Set(this.providers.values());
    this.activeProviders = Array.from(unique);
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
    return this.activeProviders;
  }
}
