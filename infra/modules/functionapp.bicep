param location string
param functionAppName string
param planName string
param storageAccountName string
param identityResourceId string
param appInsightsConnectionString string
param postgresFqdn string
param postgresDatabaseName string
param keyVaultUri string

@description('Optional subnet ID for VNet integration.')
param functionSubnetId string = ''

resource functionPlan 'Microsoft.Web/serverfarms@2020-10-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
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
      appSettings: [
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
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
          name: 'KEY_VAULT_URI'
          value: keyVaultUri
        }
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${environment().suffixes.storage};AccountKey=${listKeys(resourceId('Microsoft.Storage/storageAccounts', storageAccountName), '2023-05-01').keys[0].value}'
        }
      ]
      ftpsState: 'Disabled'
      vnetRouteAllEnabled: functionSubnetId != ''
    }
    virtualNetworkSubnetId: functionSubnetId != '' ? functionSubnetId : null
  }
}

output functionAppResourceId string = functionApp.id
output functionAppName string = functionApp.name
