targetScope = 'resourceGroup'

@description('Deployment environment name.')
@allowed([
  'dev'
  'prod'
])
param environment string

@description('Azure region for all resources. Set to westus2 by default, switch to westus3 if capacity constraints occur.')
@allowed([
  'westus2'
  'westus3'
])
param location string = 'westus2'

@description('Base name prefix used for resource naming.')
param namePrefix string = 'gpp'

@description('Enable the lowest-cost hosting shape: Functions Consumption plus public PostgreSQL networking.')
param cheapMode bool = false

@description('PostgreSQL administrator login name.')
param postgresAdminLogin string

@description('PostgreSQL administrator password.')
@secure()
param postgresAdminPassword string

@description('Whether PostgreSQL should use public access with firewall or private VNet mode.')
@allowed([
  'Public'
  'Private'
])
param postgresNetworkMode string = 'Private'

@description('Optional PostgreSQL firewall rules to create when public networking is enabled.')
param publicDatabaseFirewallRules array = []

@description('CIDR for virtual network.')
param vnetAddressPrefix string = '10.30.0.0/16'

@description('CIDR for PostgreSQL delegated subnet.')
param postgresSubnetPrefix string = '10.30.1.0/24'

@description('CIDR for Function App integration subnet.')
param functionSubnetPrefix string = '10.30.2.0/24'

// --- API application configuration (passed through to the Function App) -------
@description('Secret for signing access tokens.')
@secure()
param jwtAccessSecret string = ''
@description('Secret for signing refresh tokens.')
@secure()
param jwtRefreshSecret string = ''
@description('Stripe secret API key.')
@secure()
param stripeSecretKey string = ''
@description('Stripe webhook signing secret.')
@secure()
param stripeWebhookSecret string = ''
@description('PayPal REST app client id.')
@secure()
param paypalClientId string = ''
@description('PayPal REST app client secret.')
@secure()
param paypalClientSecret string = ''
@description('PayPal webhook id (for signature verification).')
@secure()
param paypalWebhookId string = ''
@description('OpenRouteService API key.')
@secure()
param orsApiKey string = ''
@description('Google Geocoding API key.')
@secure()
param googleGeocodingApiKey string = ''
@description('PayPal environment: sandbox or live.')
@allowed([
  'sandbox'
  'live'
])
param paypalEnv string = 'sandbox'
@description('When "true", the API fakes an active entitlement for every user (dev only).')
@allowed([
  'true'
  'false'
])
param devFakeEntitlement string = 'false'

var suffix = '${namePrefix}-${environment}'
var storageAccountName = toLower('stgpp${environment}')
var postgresServerName = 'psql-gpp-${environment}'
var functionAppName = 'func-gpp-${environment}'
var staticWebAppName = 'swa-gpp-${environment}'
var keyVaultName = 'kv-gpp-${environment}'
var logWorkspaceName = 'log-gpp-${environment}'
var appInsightsName = 'appi-gpp-${environment}'
var userAssignedIdentityName = 'id-gpp-${environment}'
var vnetName = 'vnet-${suffix}'
var effectivePostgresNetworkMode = cheapMode ? 'Public' : postgresNetworkMode
var postgresSubnetResourceId = resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, 'snet-postgres')
var functionSubnetResourceId = resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, 'snet-functions')

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = if (effectivePostgresNetworkMode == 'Private') {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: postgresSubnetPrefix
          delegations: [
            {
              name: 'postgresDelegation'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
      {
        name: 'snet-functions'
        properties: {
          addressPrefix: functionSubnetPrefix
          delegations: [
            {
              name: 'functionsDelegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
        }
      }
    ]
  }
}

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = if (effectivePostgresNetworkMode == 'Private') {
  name: 'privatelink.postgres.database.azure.com'
  location: 'global'
}

resource privateDnsVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = if (effectivePostgresNetworkMode == 'Private') {
  name: 'link-${suffix}'
  parent: privateDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

module observability './modules/observability.bicep' = if (!cheapMode) {
  params: {
    location: location
    logWorkspaceName: logWorkspaceName
    appInsightsName: appInsightsName
  }
}

module identity './modules/identity.bicep' = if (!cheapMode) {
  params: {
    location: location
    identityName: userAssignedIdentityName
  }
}

module keyVault './modules/keyvault.bicep' = if (!cheapMode) {
  params: {
    location: location
    keyVaultName: keyVaultName
    principalId: identity!.outputs.principalId
  }
}

module storage './modules/storage.bicep' = {
  params: {
    location: location
    storageAccountName: storageAccountName
    containerName: 'service-photos'
    principalId: cheapMode ? '' : identity!.outputs.principalId
  }
}

module database './modules/database.bicep' = {
  params: {
    location: location
    serverName: postgresServerName
    databaseName: 'garbage_pail_pals'
    adminLogin: postgresAdminLogin
    adminPassword: postgresAdminPassword
    networkMode: effectivePostgresNetworkMode
    delegatedSubnetId: effectivePostgresNetworkMode == 'Private' ? postgresSubnetResourceId : ''
    privateDnsZoneId: effectivePostgresNetworkMode == 'Private' ? privateDnsZone.id : ''
    publicFirewallRules: effectivePostgresNetworkMode == 'Public' ? publicDatabaseFirewallRules : []
  }
  dependsOn: [
    privateDnsVnetLink
  ]
}

module functionApp './modules/functionapp.bicep' = {
  params: {
    location: location
    functionAppName: functionAppName
    planName: 'plan-${suffix}'
    cheapMode: cheapMode
    storageAccountName: storageAccountName
    identityResourceId: cheapMode ? '' : identity!.outputs.resourceId
    appInsightsConnectionString: cheapMode ? '' : observability!.outputs.appInsightsConnectionString
    postgresFqdn: database.outputs.postgresFqdn
    postgresDatabaseName: 'garbage_pail_pals'
    postgresAdminLogin: postgresAdminLogin
    postgresAdminPassword: postgresAdminPassword
    keyVaultUri: cheapMode ? '' : keyVault!.outputs.vaultUri
    functionSubnetId: effectivePostgresNetworkMode == 'Private' ? functionSubnetResourceId : ''
    jwtAccessSecret: jwtAccessSecret
    jwtRefreshSecret: jwtRefreshSecret
    stripeSecretKey: stripeSecretKey
    stripeWebhookSecret: stripeWebhookSecret
    paypalClientId: paypalClientId
    paypalClientSecret: paypalClientSecret
    paypalWebhookId: paypalWebhookId
    orsApiKey: orsApiKey
    googleGeocodingApiKey: googleGeocodingApiKey
    paypalEnv: paypalEnv
    devFakeEntitlement: devFakeEntitlement
  }
}

module staticWebApp './modules/staticwebapp.bicep' = {
  params: {
    location: location
    staticWebAppName: staticWebAppName
  }
  dependsOn: [
    functionApp
  ]
}

output staticWebAppHostname string = staticWebApp.outputs.defaultHostname
output functionAppName string = functionApp.outputs.functionAppName
output postgresFqdn string = database.outputs.postgresFqdn
