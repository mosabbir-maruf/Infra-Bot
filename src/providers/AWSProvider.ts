import {
  EC2Client,
  StartInstancesCommand,
  StopInstancesCommand,
  RebootInstancesCommand,
  DescribeInstancesCommand,
  Instance,
} from '@aws-sdk/client-ec2';
import { CloudProvider, CloudServerInstance, CloudServerMetadata } from '../core/providers/Provider';
import { Env } from '../config/Env';
import { Logger } from '../utils/Logger';

export class AWSProvider implements CloudProvider {
  public readonly name = 'AWS';
  private readonly clients = new Map<string, EC2Client>();
  private readonly defaultRegion: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(env: Env) {
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWSProvider: Missing credentials');
    }
    this.accessKeyId = env.AWS_ACCESS_KEY_ID;
    this.secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
    this.defaultRegion = env.AWS_REGION;
  }

  /**
   * Helper to retrieve or build an EC2Client for the specific target region
   */
  private getClient(region?: string): { client: EC2Client; region: string } {
    const targetRegion = region || this.defaultRegion;
    let client = this.clients.get(targetRegion);
    if (!client) {
      client = new EC2Client({
        region: targetRegion,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });
      this.clients.set(targetRegion, client);
    }
    return { client, region: targetRegion };
  }

  public async startServer(serverId: string, region?: string): Promise<void> {
    const { client, region: targetRegion } = this.getClient(region);
    Logger.info(`AWSProvider: Starting instance ${serverId} in region ${targetRegion}`);
    await client.send(
      new StartInstancesCommand({
        InstanceIds: [serverId],
      }),
    );
  }

  public async stopServer(serverId: string, region?: string): Promise<void> {
    const { client, region: targetRegion } = this.getClient(region);
    Logger.info(`AWSProvider: Stopping instance ${serverId} in region ${targetRegion}`);
    await client.send(
      new StopInstancesCommand({
        InstanceIds: [serverId],
      }),
    );
  }

  public async rebootServer(serverId: string, region?: string): Promise<void> {
    const { client, region: targetRegion } = this.getClient(region);
    Logger.info(`AWSProvider: Rebooting instance ${serverId} in region ${targetRegion}`);
    await client.send(
      new RebootInstancesCommand({
        InstanceIds: [serverId],
      }),
    );
  }

  public async getServerStatus(serverId: string, region?: string): Promise<CloudServerInstance> {
    const { client, region: targetRegion } = this.getClient(region);
    const res = await client.send(
      new DescribeInstancesCommand({
        InstanceIds: [serverId],
      }),
    );

    const reservation = res.Reservations?.[0];
    const instance = reservation?.Instances?.[0];

    if (!instance) {
      throw new Error(`AWS EC2 Instance "${serverId}" not found in region ${targetRegion}.`);
    }

    return this.mapInstance(instance, targetRegion);
  }

  public async listServers(region?: string): Promise<CloudServerInstance[]> {
    const { client, region: targetRegion } = this.getClient(region);
    const res = await client.send(new DescribeInstancesCommand({}));
    const instances: CloudServerInstance[] = [];

    if (res.Reservations) {
      for (const reservation of res.Reservations) {
        if (reservation.Instances) {
          for (const instance of reservation.Instances) {
            instances.push(this.mapInstance(instance, targetRegion));
          }
        }
      }
    }

    return instances;
  }

  public async getInstanceMetadata(serverId: string, region?: string): Promise<CloudServerMetadata> {
    const { client, region: targetRegion } = this.getClient(region);
    const res = await client.send(
      new DescribeInstancesCommand({
        InstanceIds: [serverId],
      }),
    );

    const reservation = res.Reservations?.[0];
    const instance = reservation?.Instances?.[0];

    if (!instance) {
      throw new Error(`AWS EC2 Instance "${serverId}" not found in region ${targetRegion}.`);
    }

    return {
      instanceId: instance.InstanceId || serverId,
      instanceType: instance.InstanceType || 'unknown',
      state: instance.State?.Name || 'unknown',
      publicIp: instance.PublicIpAddress || undefined,
      privateIp: instance.PrivateIpAddress || undefined,
      availabilityZone: instance.Placement?.AvailabilityZone || undefined,
    };
  }

  private mapInstance(instance: Instance, region: string): CloudServerInstance {
    const nameTag = instance.Tags?.find((t) => t.Key === 'Name');
    const name = nameTag?.Value || instance.InstanceId || 'unnamed-ec2';

    let status: CloudServerInstance['status'] = 'unknown';
    const stateName = instance.State?.Name;
    if (stateName === 'pending') status = 'starting';
    else if (stateName === 'running') status = 'running';
    else if (stateName === 'stopping') status = 'stopping';
    else if (stateName === 'stopped') status = 'stopped';
    else if (stateName === 'shutting-down' || stateName === 'terminated') status = 'terminated';

    const az = instance.Placement?.AvailabilityZone;
    const resolvedRegion = az ? az.slice(0, -1) : region;

    return {
      id: instance.InstanceId || '',
      name,
      status,
      ipAddress: instance.PublicIpAddress || instance.PrivateIpAddress,
      provider: this.name,
      region: resolvedRegion,
      rawDetails: JSON.stringify({
        InstanceType: instance.InstanceType,
        LaunchTime: instance.LaunchTime,
      }),
    };
  }
}
