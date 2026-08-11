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

// --- Application configuration (secrets + settings the API reads at runtime) --
// Declared here so infra deploys preserve them instead of wiping app settings.
// Secret values are supplied at deploy time via secure parameters (same pattern
// as the database password), never committed to source.
@secure()
param jwtAccessSecret string = ''
@secure()
param jwtRefreshSecret string = ''
@secure()
param stripeSecretKey string = ''
@secure()
param stripeWebhookSecret string = ''
@secure()
param paypalClientId string = ''
@secure()
param paypalClientSecret string = ''
@secure()
param paypalWebhookId string = ''
@secure()
param orsApiKey string = ''
@secure()
param googleGeocodingApiKey string = ''
@description('PayPal environment: sandbox or live.')
param paypalEnv string = 'sandbox'
@description('When "true", the API fakes an active entitlement for every user (dev only).')
param devFakeEntitlement string = 'false'

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
    name: 'FUNCTIONS_EXTENSION_VERSION'
    value: '~4'
  }
  {
    name: 'FUNCTIONS_WORKER_RUNTIME'
    value: 'node'
  }
  {
    name: 'WEBSITE_NODE_DEFAULT_VERSION'
    value: '~22'
  }
  {
    name: 'AzureWebJobsFeatureFlags'
    value: 'EnableWorkerIndexing'
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

// App configuration the API reads at runtime. Secret values are only emitted
// when supplied (empty ones are skipped so the app falls back to its own
// defaults rather than getting a blank setting). PAYPAL_ENV and
// DEV_FAKE_ENTITLEMENT are always set since they are non-secret behaviour flags.
var configAppSettings = concat(
  empty(jwtAccessSecret) ? [] : [{ name: 'JWT_ACCESS_SECRET', value: jwtAccessSecret }],
  empty(jwtRefreshSecret) ? [] : [{ name: 'JWT_REFRESH_SECRET', value: jwtRefreshSecret }],
  empty(stripeSecretKey) ? [] : [{ name: 'STRIPE_SECRET_KEY', value: stripeSecretKey }],
  empty(stripeWebhookSecret) ? [] : [{ name: 'STRIPE_WEBHOOK_SECRET', value: stripeWebhookSecret }],
  empty(paypalClientId) ? [] : [{ name: 'PAYPAL_CLIENT_ID', value: paypalClientId }],
  empty(paypalClientSecret) ? [] : [{ name: 'PAYPAL_CLIENT_SECRET', value: paypalClientSecret }],
  empty(paypalWebhookId) ? [] : [{ name: 'PAYPAL_WEBHOOK_ID', value: paypalWebhookId }],
  empty(orsApiKey) ? [] : [{ name: 'ORS_API_KEY', value: orsApiKey }],
  empty(googleGeocodingApiKey) ? [] : [{ name: 'GOOGLE_GEOCODING_API_KEY', value: googleGeocodingApiKey }],
  [{ name: 'PAYPAL_ENV', value: paypalEnv }],
  [{ name: 'DEV_FAKE_ENTITLEMENT', value: devFakeEntitlement }]
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
      linuxFxVersion: 'NODE|22'
      appSettings: concat(baseAppSettings, optionalAppSettings, configAppSettings)
      ftpsState: 'Disabled'
      vnetRouteAllEnabled: functionSubnetId != ''
    }
    virtualNetworkSubnetId: functionSubnetId != '' ? functionSubnetId : null
  }
}

output functionAppResourceId string = functionApp.id
output functionAppName string = functionApp.name
