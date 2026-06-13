import { CloudProvider, CloudServerInstance, CloudServerMetadata } from '../core/providers/Provider';
import { Env } from '../config/Env';
import { Logger } from '../utils/Logger';

interface DigitalOceanDroplet {
  id: number;
  name: string;
  status: 'active' | 'new' | 'off' | 'archive';
  networks: {
    v4?: Array<{
      ip_address: string;
      type: 'public' | 'private';
    }>;
  };
  region: {
    slug: string;
  };
  size_slug: string;
  created_at: string;
}

export class DigitalOceanProvider implements CloudProvider {
  public readonly name = 'DigitalOcean';
  private readonly token: string;
  private readonly baseUrl = 'https://api.digitalocean.com/v2';
  private readonly authHeader: string;

  constructor(env: Env) {
    if (!env.DIGITALOCEAN_TOKEN) {
      throw new Error('DigitalOceanProvider: Missing token');
    }
    this.token = env.DIGITALOCEAN_TOKEN;
    this.authHeader = `Bearer ${this.token}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: this.authHeader,
      ...options.headers,
    };

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DigitalOcean API error (${response.status}): ${errText}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  public async startServer(serverId: string, _region?: string): Promise<void> {
    Logger.info(`DigitalOceanProvider: Powering on droplet ${serverId}`);
    await this.request(`/droplets/${serverId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'power_on' }),
    });
  }

  public async stopServer(serverId: string, _region?: string): Promise<void> {
    Logger.info(`DigitalOceanProvider: Powering off droplet ${serverId}`);
    await this.request(`/droplets/${serverId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'power_off' }),
    });
  }

  public async rebootServer(serverId: string, _region?: string): Promise<void> {
    Logger.info(`DigitalOceanProvider: Rebooting droplet ${serverId}`);
    await this.request(`/droplets/${serverId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'reboot' }),
    });
  }

  public async getServerStatus(serverId: string, _region?: string): Promise<CloudServerInstance> {
    Logger.info(`DigitalOceanProvider: Fetching droplet ${serverId}`);
    const data = await this.request<{ droplet: DigitalOceanDroplet }>(`/droplets/${serverId}`);
    return this.mapDroplet(data.droplet);
  }

  public async listServers(_region?: string): Promise<CloudServerInstance[]> {
    Logger.info('DigitalOceanProvider: Listing all droplets');
    const data = await this.request<{ droplets: DigitalOceanDroplet[] }>('/droplets');
    return data.droplets.map((droplet) => this.mapDroplet(droplet));
  }

  public async getInstanceMetadata(serverId: string, _region?: string): Promise<CloudServerMetadata> {
    Logger.info(`DigitalOceanProvider: Retrieving metadata for droplet ${serverId}`);
    const data = await this.request<{ droplet: DigitalOceanDroplet }>(`/droplets/${serverId}`);
    const droplet = data.droplet;

    let publicIp: string | undefined;
    let privateIp: string | undefined;
    for (const net of droplet.networks.v4 ?? []) {
      if (net.type === 'public') publicIp = net.ip_address;
      else if (net.type === 'private') privateIp = net.ip_address;
      if (publicIp && privateIp) break;
    }

    return {
      instanceId: String(droplet.id),
      instanceType: droplet.size_slug,
      state: droplet.status,
      publicIp,
      privateIp,
      availabilityZone: droplet.region.slug,
    };
  }

  private mapDroplet(droplet: DigitalOceanDroplet): CloudServerInstance {
    let status: CloudServerInstance['status'] = 'unknown';
    if (droplet.status === 'new') status = 'starting';
    else if (droplet.status === 'active') status = 'running';
    else if (droplet.status === 'off') status = 'stopped';
    else if (droplet.status === 'archive') status = 'terminated';

    const publicIp = droplet.networks.v4?.find((net) => net.type === 'public')?.ip_address;

    return {
      id: String(droplet.id),
      name: droplet.name,
      status,
      ipAddress: publicIp,
      provider: this.name,
      region: droplet.region.slug,
      rawDetails: JSON.stringify({
        Size: droplet.size_slug,
        CreatedAt: droplet.created_at,
      }),
    };
  }
}
