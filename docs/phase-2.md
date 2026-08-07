# Phase 2 Delivered

## Scope completed

- Modular Bicep templates under `infra/modules`.
- Main orchestration template and environment-specific parameter files.
- CI workflow for install, typecheck, tests, build, and Bicep compile validation.
- Deploy workflow for infrastructure, API, and web deployment.

## Infrastructure resources modeled

- Static Web App (Standard)
- Function App (Linux, Node 20) with FlexConsumption plan (`FC1`)
- Azure Database for PostgreSQL Flexible Server (`Standard_B1ms`, 32 GB)
- Storage Account + private blob container `service-photos`
- Key Vault in RBAC mode with soft delete
- Log Analytics + App Insights (workspace-based)
- User-assigned managed identity and RBAC grants
- Optional VNet + private DNS for PostgreSQL private networking

## Outputs

- `staticWebAppHostname`
- `functionAppName`
- `postgresFqdn`

## Important design note

The original requirement says PostgreSQL should be both private access and have a firewall rule for Function App. In Azure PostgreSQL Flexible Server, firewall rules apply to public access mode. When private mode is enabled, public access is disabled and firewall rules are not used.

Template behavior:

- `postgresNetworkMode = 'Private'` (default): private networking + no firewall rules.
- `postgresNetworkMode = 'Public'`: public networking + `AllowAzureServices` firewall rule.

## Region strategy

Both `dev.bicepparam` and `prod.bicepparam` default to `westus2`.
If capacity is constrained, change one line to `westus3` in the active `.bicepparam` file.
