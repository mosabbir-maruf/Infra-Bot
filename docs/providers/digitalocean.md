# DigitalOcean Droplet Provider Integration

The DigitalOcean provider adapter manages Droplets (virtual private servers) using the standard fetch-based REST requests.

## API Credentials

1. Log into your **DigitalOcean Control Panel**.
2. Navigate to **API** in the left sidebar menu.
3. Select **Tokens/Keys** tab and click **Generate New Token**.
4. Set the token name (e.g. `mosabbir-infra-bot-token`), choose **Read and Write** scopes, and set expiration.
5. Copy the generated Personal Access Token (PAT).

## Configuration

Bind the following secret in Cloudflare Secrets:
* `DIGITALOCEAN_TOKEN`: The copied personal access token.

## Command Mappings

* **Start Server**: Dispatches `POST` request to `/droplets/<id>/actions` with payload:
  ```json
  { "type": "power_on" }
  ```
* **Stop Server**: Dispatches `POST` request to `/droplets/<id>/actions` with payload:
  ```json
  { "type": "power_off" }
  ```
* **Reboot Server**: Dispatches `POST` request to `/droplets/<id>/actions` with payload:
  ```json
  { "type": "power_cycle" }
  ```
* **Get Server Status**: Dispatches `GET` request to `/droplets/<id>`. Maps DigitalOcean droplet status (`active`, `new`, `off`, `archive`) to standard status states (`running`, `stopped`, `rebooting`, `unknown`).
