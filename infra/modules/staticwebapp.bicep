param location string
param staticWebAppName string
param backendFunctionAppName string

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

resource backendLink 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  name: 'functions-backend'
  parent: staticWebApp
  properties: {
    backendResourceId: resourceId('Microsoft.Web/sites', backendFunctionAppName)
    region: location
  }
}

output defaultHostname string = staticWebApp.properties.defaultHostname
output staticWebAppName string = staticWebApp.name
