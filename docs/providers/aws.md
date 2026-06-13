# AWS EC2 Provider Integration

The AWS provider adapter implements cloud-level management of EC2 Virtual Server instances using the modular `@aws-sdk/client-ec2` package.

## IAM Credentials Policy

To follow the security principle of least privilege, create a dedicated IAM User with API keys restricted to only your target managed instances.

Attach the following IAM Policy to the bot user:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InstancePowerOperations",
      "Effect": "Allow",
      "Action": [
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:RebootInstances"
      ],
      "Resource": [
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0",
        "arn:aws:ec2:ap-south-1:123456789012:instance/i-0987654321fedcba0"
      ]
    },
    {
      "Sid": "InstanceDescribeAndTelemetry",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

*Note: Replace region, account-id, and instance-ids with your exact AWS deployment details.*

---

## ⚠️ Production Stop Operation Warning

Stopping an EC2 instance is a **high-risk action** in production environments:
* **Host Release**: When an EC2 instance transitions to `stopped`, AWS releases the underlying physical hardware capacity.
* **Capacity Failures**: If you attempt to restart the instance later (`startServer`), the operation may fail with an `InsufficientInstanceCapacity` error if the target Availability Zone is experiencing resource constraints.
* **Workload Isolation**: For software updates, configurations, or standard restarts, **prefer Reboot over Stop** as rebooting keeps the instance attached to the same host and avoids capacity release.

---

## Configuration

### Credentials

Configure the following variables in Cloudflare Secrets:
* `AWS_ACCESS_KEY_ID`: IAM user access key.
* `AWS_SECRET_ACCESS_KEY`: IAM user secret access key.
* `AWS_REGION`: The fallback default region containing EC2 instances (e.g. `us-east-1`).

### Server Registration

The dashboard and Telegram commands only recognize instances that are explicitly registered in the `SERVERS_CONFIG` environment variable. Add each EC2 instance as an entry with `provider` set to `"aws"` and the instance ID as `instanceId`:

```json
{
  "ai-gateway-prod": {
    "provider": "aws",
    "region": "ap-south-1",
    "instanceId": "i-0123456789abcdef0"
  }
}
```

Optional `"bandwidthLimitGB": 500` adds a progress bar to `/bandwidth`. The bandwidth alerts fire regardless — configure thresholds via `BANDWIDTH_ALERT_THRESHOLDS` (defaults to `50,80,95`). Override the alert threshold at runtime with `/setbandwidth <alias> <GB|remove>` via Telegram (KV takes precedence over env config).

Set it as a Cloudflare secret:

```
npx wrangler secret put SERVERS_CONFIG
```

The IAM credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are used at runtime when Telegram commands like `/start`, `/stop`, or `/status` are issued — they do not auto-discover instances for the dashboard. Only instances listed in `SERVERS_CONFIG` will appear on the dashboard and be addressable by commands.

---

## Command Mappings

* **Start Server**: Sends `StartInstancesCommand` for target `InstanceId`.
* **Stop Server**: Sends `StopInstancesCommand` for target `InstanceId` (powers down virtual machine).
* **Reboot Server**: Sends `RebootInstancesCommand` (graceful reboot, falls back to hardware reset).
* **Get Server Status**: Sends `DescribeInstancesCommand` and maps standard states:
  * `pending` ➔ `starting`
  * `running` ➔ `running`
  * `stopping` ➔ `stopping`
  * `stopped` ➔ `stopped`
  * `shutting-down` ➔ `terminated`
  * `terminated` ➔ `terminated`
* **Get Instance Metadata**: Retrieves `DescribeInstancesCommand` properties (Type, State, IPs, AZ).
