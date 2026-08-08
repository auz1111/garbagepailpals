param location string
param functionAppName string
param planName string
param cheapMode bool = false
param storageAccountName string
param identityResourceId string = ''
param appInsightsConnectionString string = ''
param postgresFqdn string
param postgresDatabaseName string
param postgresAdminLogin string
@secure()
param postgresAdminPassword string
param keyVaultUri string = ''

@description('Optional subnet ID for VNet integration.')
param functionSubnetId string = ''

var functionPlanSku = cheapMode
  ? {
      tier: 'Dynamic'
      name: 'Y1'
    }
  : {
      tier: 'ElasticPremium'
      name: 'EP1'
    }

var functionPlanProperties = cheapMode
  ? {
      reserved: true
    }
  : {
      maximumElasticWorkerCount: 20
      reserved: true
    }

var baseAppSettings = [
  {
    name: 'FUNCTIONS_WORKER_RUNTIME'
    value: 'node'
  }
  {
    name: 'WEBSITE_RUN_FROM_PACKAGE'
    value: '1'
  }
  {
    name: 'POSTGRES_HOST'
    value: postgresFqdn
  }
  {
    name: 'POSTGRES_DB'
    value: postgresDatabaseName
  }
  {
    name: 'DATABASE_URL'
    value: 'postgresql://${postgresAdminLogin}:${postgresAdminPassword}@${postgresFqdn}:5432/${postgresDatabaseName}?sslmode=require'
  }
  {
    name: 'DIRECT_URL'
    value: 'postgresql://${postgresAdminLogin}:${postgresAdminPassword}@${postgresFqdn}:5432/${postgresDatabaseName}?sslmode=require'
  }
  {
    name: 'AzureWebJobsStorage'
    value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${environment().suffixes.storage};AccountKey=${listKeys(resourceId('Microsoft.Storage/storageAccounts', storageAccountName), '2023-05-01').keys[0].value}'
  }
]

var optionalAppSettings = concat(
  empty(appInsightsConnectionString)
    ? []
    : [
        {
          name: 'APPINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
      ],
  empty(keyVaultUri)
    ? []
    : [
        {
          name: 'KEY_VAULT_URI'
          value: keyVaultUri
        }
      ]
)

resource functionPlan 'Microsoft.Web/serverfarms@2020-10-01' = {
  name: planName
  location: location
  kind: cheapMode ? 'functionapp' : 'linux'
  sku: functionPlanSku
  properties: functionPlanProperties
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: empty(identityResourceId)
    ? null
    : {
        type: 'UserAssigned'
        userAssignedIdentities: {
          '${identityResourceId}': {}
        }
      }
  properties: {
    serverFarmId: functionPlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      appSettings: concat(baseAppSettings, optionalAppSettings)
      ftpsState: 'Disabled'
      vnetRouteAllEnabled: functionSubnetId != ''
    }
    virtualNetworkSubnetId: functionSubnetId != '' ? functionSubnetId : null
  }
}

output functionAppResourceId string = functionApp.id
output functionAppName string = functionApp.name
