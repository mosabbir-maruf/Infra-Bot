export interface CloudServerInstance {
  id: string;
  name: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'unknown';
  ipAddress?: string;
  provider: string;
  region: string;
  rawDetails?: string;
}

export interface CloudServerMetadata {
  instanceId: string;
  instanceType: string;
  state: string;
  publicIp?: string;
  privateIp?: string;
  availabilityZone?: string;
}

export interface CloudProvider {
  readonly name: string;
  startServer(serverId: string, region?: string): Promise<void>;
  stopServer(serverId: string, region?: string): Promise<void>;
  rebootServer(serverId: string, region?: string): Promise<void>;
  getServerStatus(serverId: string, region?: string): Promise<CloudServerInstance>;
  listServers(region?: string): Promise<CloudServerInstance[]>;
  getInstanceMetadata(serverId: string, region?: string): Promise<CloudServerMetadata>;
}
