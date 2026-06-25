import { CloudProvider, CloudServerInstance, CloudServerMetadata } from '../core/providers/Provider';
import { Env } from '../config/Env';
import { Logger } from '../utils/Logger';

interface AzureTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface AzureVMInstanceView {
  statuses?: Array<{ code: string; displayStatus: string; level?: string }>;
}

interface AzureVMProperties {
  vmId: string;
  hardwareProfile: { vmSize: string };
  provisioningState?: string;
  instanceView?: AzureVMInstanceView;
  networkProfile?: {
    networkInterfaces?: Array<{ id: string }>;
  };
}

interface AzureVM {
  name: string;
  id: string;
  location: string;
  properties: AzureVMProperties;
  tags?: Record<string, string>;
}

interface AzureVMListResult {
  value: AzureVM[];
}

interface NicIPConfiguration {
  properties?: {
    privateIPAddress?: string;
    publicIPAddress?: { id: string };
  };
}

interface NicProperties {
  ipConfigurations?: NicIPConfiguration[];
}

interface NicResponse {
  properties: NicProperties;
}

interface PublicIPProperties {
  ipAddress?: string;
}

interface PublicIPResponse {
  properties: PublicIPProperties;
}

const RESOURCE_GROUP_REGEX = /\/resourceGroups\/([^/]+)/i;
const NIC_NAME_REGEX = /\/networkInterfaces\/([^/]+)/i;
const API_VERSION = '2024-03-01';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

type JsonHeaders = Record<string, string>;

export class AzureProvider implements CloudProvider {
  public readonly name = 'Azure';
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly subscriptionId: string;
  private readonly baseUrl: string;

  private cachedToken: { token: string; expiresAt: number } | null = null;
  private tokenRefreshPromise: Promise<string> | null = null;
  private vmFetchPromises: Map<string, Promise<{ vm: AzureVM; ips: { publicIp?: string; privateIp?: string } }>> = new Map();

  constructor(env: Env) {
    if (!env.AZURE_TENANT_ID || !env.AZURE_CLIENT_ID || !env.AZURE_CLIENT_SECRET || !env.AZURE_SUBSCRIPTION_ID) {
      throw new Error('AzureProvider: Missing credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID)');
    }
    this.tenantId = env.AZURE_TENANT_ID;
    this.clientId = env.AZURE_CLIENT_ID;
    this.clientSecret = env.AZURE_CLIENT_SECRET;
    this.subscriptionId = env.AZURE_SUBSCRIPTION_ID;
    this.baseUrl = `https://management.azure.com/subscriptions/${this.subscriptionId}`;
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.tokenRefreshPromise = this.doRefreshToken();
    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = null;
    }
  }

  private async doRefreshToken(): Promise<string> {
    Logger.info('AzureProvider: Acquiring new OAuth2 token');
    const response = await fetch(
      `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: 'https://management.azure.com/.default',
        }).toString(),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Azure OAuth2 token error (${response.status}): ${errText}`);
    }

    const data: AzureTokenResponse = await response.json();
    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000 - TOKEN_REFRESH_BUFFER_MS),
    };

    return data.access_token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    const headers: JsonHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (options.headers) {
      const incoming = options.headers as JsonHeaders;
      for (const key in incoming) {
        if (Object.prototype.hasOwnProperty.call(incoming, key)) {
          headers[key] = incoming[key];
        }
      }
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Azure API error (${response.status}): ${errText}`);
    }

    if (response.status === 204 || response.status === 202) {
      return {} as T;
    }

    return response.json();
  }

  private parseServerId(serverId: string): { resourceGroup: string; vmName: string } {
    const parts = serverId.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`AzureProvider: Invalid server ID "${serverId}". Expected format: "resourceGroup/vmName"`);
    }
    return { resourceGroup: parts[0], vmName: parts[1] };
  }

  private vmPath(resourceGroup: string, vmName: string): string {
    return `/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Compute/virtualMachines/${encodeURIComponent(vmName)}`;
  }

  private extractResourceGroup(vmId: string): string {
    const match = RESOURCE_GROUP_REGEX.exec(vmId);
    if (!match) return 'unknown';
    return match[1];
  }

  private powerStatus(instanceView?: AzureVMInstanceView): CloudServerInstance['status'] {
    if (!instanceView?.statuses) return 'unknown';
    const powerState = instanceView.statuses.find((s) => s.code?.startsWith('PowerState/'));
    if (!powerState) return 'unknown';

    const code = powerState.code;
    if (code === 'PowerState/running') return 'running';
    if (code === 'PowerState/starting') return 'starting';
    if (code === 'PowerState/stopping' || code === 'PowerState/deallocating') return 'stopping';
    if (code === 'PowerState/stopped' || code === 'PowerState/deallocated') return 'stopped';
    return 'unknown';
  }

  private async fetchVMIPs(vm: AzureVM): Promise<{ publicIp?: string; privateIp?: string }> {
    const nics = vm.properties.networkProfile?.networkInterfaces;
    if (!nics || nics.length === 0) return {};

    const nicResults = await Promise.allSettled(
      nics.map(async (nic) => {
        const nicRg = this.extractResourceGroup(nic.id);
        const nicName = NIC_NAME_REGEX.exec(nic.id)?.[1];
        if (!nicRg || !nicName) return;

        const nicData = await this.request<NicResponse>(
          `/resourceGroups/${encodeURIComponent(nicRg)}/providers/Microsoft.Network/networkInterfaces/${encodeURIComponent(nicName)}?api-version=${API_VERSION}`,
        );

        const ipConfig = nicData.properties?.ipConfigurations?.[0]?.properties;
        return {
          privateIp: ipConfig?.privateIPAddress,
          pipId: ipConfig?.publicIPAddress?.id,
        };
      }),
    );

    let publicIp: string | undefined;
    let privateIp: string | undefined;

    for (const result of nicResults) {
      if (result.status === 'fulfilled' && result.value) {
        if (!privateIp) privateIp = result.value.privateIp;
        if (!publicIp && result.value.pipId) {
          const pipRg = this.extractResourceGroup(result.value.pipId);
          const pipName = result.value.pipId.split('/').pop();
          if (pipRg && pipName) {
            try {
              const pipData = await this.request<PublicIPResponse>(
                `/resourceGroups/${encodeURIComponent(pipRg)}/providers/Microsoft.Network/publicIPAddresses/${encodeURIComponent(pipName)}?api-version=${API_VERSION}`,
              );
              publicIp = pipData.properties?.ipAddress;
            } catch {
              // Public IP query failed — skip
            }
          }
        }
      }
    }

    return { publicIp, privateIp };
  }

  private mapVM(vm: AzureVM): CloudServerInstance {
    const resourceGroup = this.extractResourceGroup(vm.id);

    return {
      id: `${resourceGroup}/${vm.name}`,
      name: vm.name,
      status: this.powerStatus(vm.properties.instanceView),
      provider: this.name,
      region: vm.location,
      rawDetails: JSON.stringify({
        VmSize: vm.properties.hardwareProfile.vmSize,
        ProvisioningState: vm.properties.provisioningState,
        VmId: vm.properties.vmId,
      }),
    };
  }

  private async fetchVMWithIPs(serverId: string): Promise<{ vm: AzureVM; ips: { publicIp?: string; privateIp?: string } }> {
    const cached = this.vmFetchPromises.get(serverId);
    if (cached) return cached;

    const promise = this.doFetchVMWithIPs(serverId);
    this.vmFetchPromises.set(serverId, promise);

    try {
      return await promise;
    } finally {
      this.vmFetchPromises.delete(serverId);
    }
  }

  private async doFetchVMWithIPs(serverId: string): Promise<{ vm: AzureVM; ips: { publicIp?: string; privateIp?: string } }> {
    const { resourceGroup, vmName } = this.parseServerId(serverId);
    const vm = await this.request<AzureVM>(
      `${this.vmPath(resourceGroup, vmName)}?$expand=instanceView&api-version=${API_VERSION}`,
    );
    const ips = await this.fetchVMIPs(vm);
    return { vm, ips };
  }

  public async startServer(serverId: string, _region?: string): Promise<void> {
    const { resourceGroup, vmName } = this.parseServerId(serverId);
    Logger.info(`AzureProvider: Starting VM ${vmName} in resource group ${resourceGroup}`);
    await this.request(`${this.vmPath(resourceGroup, vmName)}/start?api-version=${API_VERSION}`, { method: 'POST' });
  }

  public async stopServer(serverId: string, _region?: string): Promise<void> {
    const { resourceGroup, vmName } = this.parseServerId(serverId);
    Logger.info(`AzureProvider: Stopping VM ${vmName} in resource group ${resourceGroup}`);
    await this.request(`${this.vmPath(resourceGroup, vmName)}/powerOff?api-version=${API_VERSION}`, { method: 'POST' });
  }

  public async rebootServer(serverId: string, _region?: string): Promise<void> {
    const { resourceGroup, vmName } = this.parseServerId(serverId);
    Logger.info(`AzureProvider: Rebooting VM ${vmName} in resource group ${resourceGroup}`);
    await this.request(`${this.vmPath(resourceGroup, vmName)}/restart?api-version=${API_VERSION}`, { method: 'POST' });
  }

  public async getServerStatus(serverId: string, _region?: string): Promise<CloudServerInstance> {
    const { vm, ips } = await this.fetchVMWithIPs(serverId);
    const result = this.mapVM(vm);
    if (ips.publicIp || ips.privateIp) {
      result.ipAddress = ips.publicIp || ips.privateIp;
    }
    return result;
  }

  public async listServers(_region?: string): Promise<CloudServerInstance[]> {
    const data = await this.request<AzureVMListResult>(
      `/providers/Microsoft.Compute/virtualMachines?$expand=instanceView&api-version=${API_VERSION}`,
    );
    return data.value.map((vm) => this.mapVM(vm));
  }

  public async getInstanceMetadata(serverId: string, _region?: string): Promise<CloudServerMetadata> {
    const { vm, ips } = await this.fetchVMWithIPs(serverId);

    const instanceView = vm.properties.instanceView;
    const powerState = instanceView?.statuses?.find((s) => s.code?.startsWith('PowerState/'));
    const provisioningState = instanceView?.statuses?.find((s) => s.code?.startsWith('ProvisioningState/'));

    return {
      instanceId: vm.properties.vmId,
      instanceType: vm.properties.hardwareProfile.vmSize,
      state: powerState?.displayStatus || provisioningState?.displayStatus || 'unknown',
      publicIp: ips.publicIp,
      privateIp: ips.privateIp,
      availabilityZone: vm.location,
    };
  }
}
