export interface RegistryServer {
  provider: 'aws' | 'digitalocean' | 'do';
  id: string; // Uniform identifier used internally by commands
  instanceId?: string; // Explicit identifier for AWS
  dropletId?: string; // Explicit identifier for DigitalOcean
  region?: string;
  bandwidthLimitGB?: number;
}

export class ServerRegistry {
  private readonly servers = new Map<string, RegistryServer>();
  private cachedAliases: string[] | null = null;
  private cachedAllServers: Array<{ alias: string } & RegistryServer> | null = null;

  constructor(configJson: string) {
    if (!configJson || configJson.trim() === '') {
      throw new Error('Registry configuration string is empty');
    }

    try {
      const parsed = JSON.parse(configJson) as Record<string, unknown>;
      for (const [alias, data] of Object.entries(parsed)) {
        if (typeof data !== 'object' || data === null) {
          throw new Error(`Invalid config format for server alias "${alias}"`);
        }

        const serverObj = data as Record<string, unknown>;
        const provider = serverObj.provider;
        const region = serverObj.region;
        const bandwidthLimitGB = serverObj.bandwidthLimitGB;

        if (
          typeof provider !== 'string' ||
          !['aws', 'digitalocean', 'do'].includes(provider.toLowerCase())
        ) {
          throw new Error(`Invalid or missing provider for server "${alias}"`);
        }

        const normProvider = provider.toLowerCase();
        let id = '';
        let instanceId: string | undefined;
        let dropletId: string | undefined;

        if (normProvider === 'aws') {
          instanceId = typeof serverObj.instanceId === 'string' ? serverObj.instanceId : undefined;
          const legacyId = typeof serverObj.id === 'string' ? serverObj.id : undefined;
          id = instanceId || legacyId || '';
          if (id.trim() === '') {
            throw new Error(`Invalid or missing instanceId/id for AWS server "${alias}"`);
          }
        } else if (normProvider === 'digitalocean' || normProvider === 'do') {
          if (typeof serverObj.dropletId === 'string') {
            dropletId = serverObj.dropletId;
          } else if (typeof serverObj.dropletId === 'number') {
            dropletId = String(serverObj.dropletId);
          }

          let legacyId: string | undefined;
          if (typeof serverObj.id === 'string') {
            legacyId = serverObj.id;
          } else if (typeof serverObj.id === 'number') {
            legacyId = String(serverObj.id);
          }

          id = dropletId || legacyId || '';
          if (id.trim() === '') {
            throw new Error(`Invalid or missing dropletId/id for DigitalOcean server "${alias}"`);
          }
        }

        if (region !== undefined && typeof region !== 'string') {
          throw new Error(`Invalid region type for server "${alias}"`);
        }

        if (bandwidthLimitGB !== undefined && typeof bandwidthLimitGB !== 'number') {
          throw new Error(`Invalid bandwidthLimitGB type for server "${alias}"`);
        }

        this.servers.set(alias.toLowerCase(), {
          provider: normProvider as RegistryServer['provider'],
          id,
          instanceId,
          dropletId,
          region: region || undefined,
          bandwidthLimitGB: bandwidthLimitGB || undefined,
        });
      }
    } catch (err) {
      throw new Error(`Failed to parse Server Registry configuration: ${(err as Error).message}`);
    }
  }

  /**
   * Retrieves server configuration by its alias name (case insensitive)
   */
  public getServer(alias: string): RegistryServer | undefined {
    return this.servers.get(alias.toLowerCase());
  }

  /**
   * Returns a list of all defined server alias names
   */
  public getAliases(): string[] {
    if (!this.cachedAliases) {
      this.cachedAliases = Array.from(this.servers.keys());
    }
    return this.cachedAliases;
  }

  /**
   * Returns a list of all registered servers including their aliases
   */
  public getAllServers(): Array<{ alias: string } & RegistryServer> {
    if (!this.cachedAllServers) {
      this.cachedAllServers = Array.from(this.servers.entries()).map(([alias, config]) => ({
        alias,
        ...config,
      }));
    }
    return this.cachedAllServers;
  }
}
