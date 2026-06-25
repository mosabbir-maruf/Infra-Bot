# Azure VM Provider Integration

The Azure provider adapter manages Virtual Machines using fetch-based REST requests against the Azure Resource Manager API (`management.azure.com`).

## Authentication

Azure uses **OAuth2 client credentials** (service principal) for API authentication.

| Variable | Where to find it |
|---|---|
| `AZURE_TENANT_ID` | App registration → **Directory (tenant) ID** |
| `AZURE_CLIENT_ID` | App registration → **Application (client) ID** |
| `AZURE_CLIENT_SECRET` | App registration → **Certificates & secrets** → create a secret → copy the **Value** column (long random string, *not* the Secret ID) |
| `AZURE_SUBSCRIPTION_ID` | Azure Portal → **Subscriptions** → your subscription → **Subscription ID** |

### Create a Service Principal

1. Open the **Azure Portal** → **Microsoft Entra ID** (formerly Azure Active Directory).
2. Navigate to **App registrations** → **New registration**.
3. Name it (e.g. `infra-bot-sp`), leave the other defaults, and **Register**.
4. Copy the **Application (client) ID** and **Directory (tenant) ID** — these are `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`.

### Generate a Client Secret

1. In your app registration, go to **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Add a description and expiration (recommend 12–24 months), then **Add**.
3. **Copy the secret value immediately** — you will not see it again. This is `AZURE_CLIENT_SECRET`.

> ⚠ **Important:** Azure displays two columns: **Secret ID** (a UUID identifier) and **Value** (the actual secret). Copy the **Value**, not the Secret ID. The value is a long random string (e.g. `q8n~abcDEF...`), while the Secret ID looks like a UUID (`0000...`). If you accidentally copy the Secret ID, authentication will fail with `AADSTS7000215`.

### Assign RBAC Role

1. Go to **Subscriptions** → select your subscription → **Access control (IAM)** → **Add** → **Add role assignment**.
2. Select the role **Virtual Machine Contributor** (or a custom role with `Microsoft.Compute/virtualMachines/read`, `Microsoft.Compute/virtualMachines/start/action`, `Microsoft.Compute/virtualMachines/powerOff/action`, `Microsoft.Compute/virtualMachines/restart/action`).
3. Click **Members** → **Select members** → search for your app registration name → select it.
4. Click **Review + assign**.

Your subscription ID is found under **Subscriptions** → your subscription → **Overview** → **Subscription ID**.

## Configuration

### Credentials

Configure the following secrets in Cloudflare Secrets:

```
npx wrangler secret put AZURE_TENANT_ID
npx wrangler secret put AZURE_CLIENT_ID
npx wrangler secret put AZURE_CLIENT_SECRET
npx wrangler secret put AZURE_SUBSCRIPTION_ID
```

Or for local development, add them to `.dev.vars`:

```
AZURE_TENANT_ID="00000000-0000-0000-0000-000000000000"
AZURE_CLIENT_ID="00000000-0000-0000-0000-000000000001"
AZURE_CLIENT_SECRET="q8n~abcDEF0123456789_long_random_secret_value_generated_by_azure"
AZURE_SUBSCRIPTION_ID="00000000-0000-0000-0000-000000000002"
AZURE_REGION="eastus"
```

`AZURE_REGION` is optional (default: `eastus`). It is used as a fallback display value.

### Server Registration

Azure VMs are identified by their **resource group** and **VM name**. Add each VM as an entry with `provider` set to `"azure"`:

```json
{
  "app-vm-prod": {
    "provider": "azure",
    "resourceGroup": "production-rg",
    "vmName": "app-vm-prod-01"
  }
}
```

The `region` field is optional. If omitted, the provider returns the Azure region (location) where the VM is deployed.

Optional `"bandwidthLimitGB": 500` adds a progress bar to `/bandwidth`. Bandwidth alerts are disabled by default and only fire when a threshold is configured via Telegram using `/setbandwidth` (e.g. `/setbandwidth <alias> <GB|remove>`). The Telegram threshold takes precedence over `bandwidthLimitGB` in `SERVERS_CONFIG`.

**Finding VM details:** In the Azure Portal, navigate to **Virtual Machines** → select your VM. The resource group and VM name are shown at the top of the overview page. The resource group also appears in the URL path: `/resourceGroups/{resourceGroup}/providers/Microsoft.Compute/virtualMachines/{vmName}`.

> ⚠ **Don't use the example value `production-rg` literally** — replace it with your actual resource group name. If you get `ResourceGroupNotFound`, the resource group name in your config doesn't match any group in your subscription. Copy it exactly from the Azure Portal VM overview page.

Set it as a Cloudflare secret:

```
npx wrangler secret put SERVERS_CONFIG
```

The credentials are used at runtime when Telegram commands like `/start`, `/stop`, or `/status` are issued — they do not auto-discover VMs for the dashboard. Only VMs listed in `SERVERS_CONFIG` will appear on the dashboard and be addressable by commands.

## How It Works

### OAuth2 Token Acquisition

On startup, the provider uses the client credentials flow:

```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}&scope=https://management.azure.com/.default
```

The access token is cached in memory and automatically refreshed before expiry (with a 60-second buffer). Concurrent requests during token expiry share a single refresh promise to avoid thundering herd.

### API Calls

All management operations use the Azure Resource Manager REST API:

| Operation | HTTP Method | Endpoint |
|---|---|---|
| Start VM | `POST` | `/subscriptions/{subId}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vm}/start` |
| Stop VM | `POST` | `.../virtualMachines/{vm}/powerOff` |
| Reboot VM | `POST` | `.../virtualMachines/{vm}/restart` |
| Get Status | `GET` | `.../virtualMachines/{vm}?$expand=instanceView` |
| List VMs | `GET` | `/subscriptions/{subId}/providers/Microsoft.Compute/virtualMachines?$expand=instanceView` |

The `$expand=instanceView` parameter includes power state and provisioning status inline, eliminating a separate API call.

## Command Mappings

* **Start Server**: `POST .../virtualMachines/{vmName}/start` — Powers on a deallocated or stopped VM.
* **Stop Server**: `POST .../virtualMachines/{vmName}/powerOff` — Powers off the VM. Use **Stop** (deallocate) to avoid continued compute charges. Note: stopped (deallocated) VMs lose their public IP unless it is a static IP resource.
* **Reboot Server**: `POST .../virtualMachines/{vmName}/restart` — Graceful OS reboot.
* **Get Server Status**: `GET .../virtualMachines/{vmName}?$expand=instanceView`
* **List Servers**: `GET .../virtualMachines?$expand=instanceView`
* **Instance Metadata**: Returns VM ID, size, power state, and availability zone (region).

## Status Mapping

| Azure PowerState | Mapped Status | Meaning |
|---|---|---|
| `PowerState/starting` | `starting` | VM is transitioning to running |
| `PowerState/running` | `running` | VM is powered on |
| `PowerState/stopping` | `stopping` | VM is stopping |
| `PowerState/deallocating` | `stopping` | VM is being deallocated |
| `PowerState/stopped` | `stopped` | VM is stopped (still allocated) |
| `PowerState/deallocated` | `stopped` | VM is deallocated (no compute charges) |
| *other/missing* | `unknown` | Unrecognized or transitional state |

## Security Considerations

- The service principal should be scoped to the **minimum required actions** (`read`, `start`, `powerOff`, `restart` on the specific VMs or resource group).
- Use **Virtual Machine Contributor** role for simplicity, or create a custom RBAC role with only the required permissions.
- Rotate client secrets regularly. Azure supports setting expiry dates on secrets.
- Never commit secrets to version control. Use Cloudflare Secrets or `.dev.vars` (gitignored).
