# Infrastructure (Phase 2)

This folder contains modular Bicep templates for Garbage Pail Pals.

## Files

- main.bicep: entrypoint that composes all modules
- dev.bicepparam: development parameters
- prod.bicepparam: production parameters
- modules/: per-resource modules

## Deployment

Create the resource group if needed:

```powershell
az group create --name garbagepailpals --location westus2
```

Deploy for dev:

```powershell
$env:POSTGRES_ADMIN_PASSWORD_DEV="<strong-password>"
az deployment group create `
  --resource-group garbagepailpals `
  --template-file infra/main.bicep `
  --parameters infra/dev.bicepparam
```

Deploy for prod:

```powershell
$env:POSTGRES_ADMIN_PASSWORD_PROD="<strong-password>"
az deployment group create `
  --resource-group garbagepailpals `
  --template-file infra/main.bicep `
  --parameters infra/prod.bicepparam
```

## Outputs

- staticWebAppHostname
- functionAppName
- postgresFqdn

## Region switch

To use West US 3 fallback, change one line in the active .bicepparam file:

```bicep
param location = 'westus3'
```

## Networking note

`postgresNetworkMode` defaults to `Private` and disables public network access for PostgreSQL.
If you switch to `Public`, the template creates an `AllowAzureServices` firewall rule.
