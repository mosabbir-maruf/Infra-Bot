import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { AWSProvider } from '../src/providers/AWSProvider';
import { DigitalOceanProvider } from '../src/providers/DigitalOceanProvider';
import { AzureProvider } from '../src/providers/AzureProvider';
import { Env } from '../src/config/Env';

// Mock EC2 Client and SDK commands
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-ec2', () => {
  return {
    EC2Client: vi.fn().mockImplementation(function (this: any) {
      return {
        send: mockSend,
        config: { region: 'us-east-1' },
      };
    }),
    StartInstancesCommand: vi.fn().mockImplementation(function (args) { return { type: 'start', ...args }; }),
    StopInstancesCommand: vi.fn().mockImplementation(function (args) { return { type: 'stop', ...args }; }),
    RebootInstancesCommand: vi.fn().mockImplementation(function (args) { return { type: 'reboot', ...args }; }),
    DescribeInstancesCommand: vi.fn().mockImplementation(function (args) { return { type: 'describe', ...args }; }),
  };
});

// Mock logger
vi.mock('../src/utils/Logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Provider Adapters', () => {
  const mockEnv: Env = {
    TELEGRAM_BOT_TOKEN: 'mock-bot-token',
    AUTHORIZED_USER_IDS: [12345],
    AWS_ACCESS_KEY_ID: 'mock-aws-key',
    AWS_SECRET_ACCESS_KEY: 'mock-aws-secret',
    AWS_REGION: 'us-west-2',
    DIGITALOCEAN_TOKEN: 'mock-do-token',
    AZURE_TENANT_ID: 'mock-tenant-id',
    AZURE_CLIENT_ID: 'mock-client-id',
    AZURE_CLIENT_SECRET: 'mock-client-secret',
    AZURE_SUBSCRIPTION_ID: 'mock-sub-id',
    AZURE_REGION: 'eastus',
    NODE_ENV: 'test',
    SERVERS_CONFIG: '{"ai-gateway-prod":{"provider":"aws","region":"ap-south-1","instanceId":"i-0123"}}',
    MONITORING_SECRET: 'mock-secret',
  };

  const globalFetch = globalThis.fetch;
  const mockFetch = vi.fn();

  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    vi.clearAllMocks();
  });

  afterAll(() => {
    globalThis.fetch = globalFetch;
  });

  describe('AWSProvider', () => {
    it('should trigger EC2 SDK Send command on startServer', async () => {
      mockSend.mockResolvedValueOnce({});
      const provider = new AWSProvider(mockEnv);
      await provider.startServer('i-0123456789abcdef0', 'us-west-2');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should map EC2 instance status correctly', async () => {
      mockSend.mockResolvedValueOnce({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: 'i-12345',
                State: { Name: 'pending' },
                PublicIpAddress: '203.0.113.5',
                Tags: [{ Key: 'Name', Value: 'web-prod-01' }],
                InstanceType: 't3.micro',
                LaunchTime: new Date(),
              },
            ],
          },
        ],
      });

      const provider = new AWSProvider(mockEnv);
      const status = await provider.getServerStatus('i-12345', 'us-west-2');

      expect(status.id).toBe('i-12345');
      expect(status.name).toBe('web-prod-01');
      expect(status.status).toBe('starting'); // pending -> starting
      expect(status.ipAddress).toBe('203.0.113.5');
      expect(status.provider).toBe('AWS');
    });

    it('should fetch and map EC2 instance metadata correctly', async () => {
      mockSend.mockResolvedValueOnce({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: 'i-12345',
                State: { Name: 'running' },
                PublicIpAddress: '203.0.113.5',
                PrivateIpAddress: '10.0.0.5',
                InstanceType: 't3.medium',
                Placement: { AvailabilityZone: 'us-west-2b' },
              },
            ],
          },
        ],
      });

      const provider = new AWSProvider(mockEnv);
      const meta = await provider.getInstanceMetadata('i-12345', 'us-west-2');

      expect(meta.instanceId).toBe('i-12345');
      expect(meta.instanceType).toBe('t3.medium');
      expect(meta.state).toBe('running');
      expect(meta.publicIp).toBe('203.0.113.5');
      expect(meta.privateIp).toBe('10.0.0.5');
      expect(meta.availabilityZone).toBe('us-west-2b');
    });
  });

  describe('DigitalOceanProvider', () => {
    it('should trigger POST fetch request to actions endpoint on startServer', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const provider = new DigitalOceanProvider(mockEnv);
      await provider.startServer('888888');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.digitalocean.com/v2/droplets/888888/actions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-do-token',
          }),
          body: JSON.stringify({ type: 'power_on' }),
        }),
      );
    });

    it('should fetch status and parse IP networks correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          droplet: {
            id: 888888,
            name: 'api-prod-01',
            status: 'active',
            networks: {
              v4: [
                { ip_address: '10.0.0.1', type: 'private' },
                { ip_address: '198.51.100.12', type: 'public' },
              ],
            },
            region: { slug: 'nyc3' },
            size_slug: 's-1vcpu-1gb',
            created_at: '2026-01-01T00:00:00Z',
          },
        }),
      });

      const provider = new DigitalOceanProvider(mockEnv);
      const res = await provider.getServerStatus('888888');

      expect(res.id).toBe('888888');
      expect(res.name).toBe('api-prod-01');
      expect(res.status).toBe('running');
      expect(res.ipAddress).toBe('198.51.100.12');
      expect(res.provider).toBe('DigitalOcean');
      expect(res.region).toBe('nyc3');
    });

    it('should fetch and map Droplet instance metadata correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          droplet: {
            id: 888888,
            status: 'off',
            networks: {
              v4: [
                { ip_address: '10.0.0.2', type: 'private' },
                { ip_address: '198.51.100.13', type: 'public' },
              ],
            },
            region: { slug: 'sfo3' },
            size_slug: 's-2vcpu-2gb',
          },
        }),
      });

      const provider = new DigitalOceanProvider(mockEnv);
      const meta = await provider.getInstanceMetadata('888888');

      expect(meta.instanceId).toBe('888888');
      expect(meta.instanceType).toBe('s-2vcpu-2gb');
      expect(meta.state).toBe('off');
      expect(meta.publicIp).toBe('198.51.100.13');
      expect(meta.privateIp).toBe('10.0.0.2');
      expect(meta.availabilityZone).toBe('sfo3');
    });
  });

  describe('AzureProvider', () => {
    it('should acquire OAuth2 token and start a VM', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'mock-azure-token',
            expires_in: 3599,
            token_type: 'Bearer',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({}),
        });

      const provider = new AzureProvider(mockEnv);
      await provider.startServer('production-rg/app-vm-prod-01');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/mock-tenant-id/oauth2/v2.0/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://management.azure.com/subscriptions/mock-sub-id/resourceGroups/production-rg/providers/Microsoft.Compute/virtualMachines/app-vm-prod-01/start?api-version=2024-03-01',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-azure-token',
          }),
        }),
      );
    });

    it('should stop a VM', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'mock-azure-token',
            expires_in: 3599,
            token_type: 'Bearer',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({}),
        });

      const provider = new AzureProvider(mockEnv);
      await provider.stopServer('production-rg/app-vm-prod-01');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://management.azure.com/subscriptions/mock-sub-id/resourceGroups/production-rg/providers/Microsoft.Compute/virtualMachines/app-vm-prod-01/powerOff?api-version=2024-03-01',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should reboot a VM', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'mock-azure-token',
            expires_in: 3599,
            token_type: 'Bearer',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({}),
        });

      const provider = new AzureProvider(mockEnv);
      await provider.rebootServer('production-rg/app-vm-prod-01');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://management.azure.com/subscriptions/mock-sub-id/resourceGroups/production-rg/providers/Microsoft.Compute/virtualMachines/app-vm-prod-01/restart?api-version=2024-03-01',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should fetch VM status and map status correctly', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'mock-azure-token',
            expires_in: 3599,
            token_type: 'Bearer',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: 'app-vm-prod-01',
            id: '/subscriptions/mock-sub-id/resourceGroups/production-rg/providers/Microsoft.Compute/virtualMachines/app-vm-prod-01',
            location: 'eastus',
            properties: {
              vmId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              hardwareProfile: { vmSize: 'Standard_D2s_v3' },
              provisioningState: 'Succeeded',
              instanceView: {
                statuses: [
                  { code: 'ProvisioningState/succeeded', displayStatus: 'Provisioning succeeded', level: 'Info' },
                  { code: 'PowerState/running', displayStatus: 'VM running', level: 'Info' },
                ],
              },
            },
          }),
        });

      const provider = new AzureProvider(mockEnv);
      const status = await provider.getServerStatus('production-rg/app-vm-prod-01');

      expect(status.id).toBe('production-rg/app-vm-prod-01');
      expect(status.name).toBe('app-vm-prod-01');
      expect(status.status).toBe('running');
      expect(status.provider).toBe('Azure');
      expect(status.region).toBe('eastus');
    });

    it('should fetch and map instance metadata correctly', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'mock-azure-token',
            expires_in: 3599,
            token_type: 'Bearer',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: 'app-vm-prod-01',
            id: '/subscriptions/mock-sub-id/resourceGroups/production-rg/providers/Microsoft.Compute/virtualMachines/app-vm-prod-01',
            location: 'eastus',
            properties: {
              vmId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              hardwareProfile: { vmSize: 'Standard_D2s_v3' },
              provisioningState: 'Succeeded',
              instanceView: {
                statuses: [
                  { code: 'PowerState/stopped', displayStatus: 'VM stopped', level: 'Info' },
                ],
              },
            },
          }),
        });

      const provider = new AzureProvider(mockEnv);
      const meta = await provider.getInstanceMetadata('production-rg/app-vm-prod-01');

      expect(meta.instanceId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(meta.instanceType).toBe('Standard_D2s_v3');
      expect(meta.state).toBe('VM stopped');
      expect(meta.availabilityZone).toBe('eastus');
    });

    it('should handle stopped/deallocated power states', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'mock-azure-token',
            expires_in: 3599,
            token_type: 'Bearer',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: 'app-vm-prod-01',
            id: '/subscriptions/mock-sub-id/resourceGroups/production-rg/providers/Microsoft.Compute/virtualMachines/app-vm-prod-01',
            location: 'eastus',
            properties: {
              vmId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              hardwareProfile: { vmSize: 'Standard_D2s_v3' },
              instanceView: {
                statuses: [
                  { code: 'PowerState/deallocated', displayStatus: 'VM deallocated', level: 'Info' },
                ],
              },
            },
          }),
        });

      const provider = new AzureProvider(mockEnv);
      const status = await provider.getServerStatus('production-rg/app-vm-prod-01');

      expect(status.status).toBe('stopped');
    });

    it('should throw error for invalid server ID format', async () => {
      const provider = new AzureProvider(mockEnv);
      await expect(provider.startServer('invalid-id')).rejects.toThrow(
        'AzureProvider: Invalid server ID "invalid-id". Expected format: "resourceGroup/vmName"',
      );
    });

    it('should throw error on missing credentials', () => {
      expect(() => new AzureProvider({ ...mockEnv, AZURE_TENANT_ID: undefined })).toThrow(
        'AzureProvider: Missing credentials',
      );
    });
  });
});
