param location string
param serverName string
param databaseName string
param adminLogin string
@secure()
param adminPassword string

@allowed([
  'Public'
  'Private'
])
param networkMode string

@description('Delegated subnet resource ID. Required when networkMode is Private.')
param delegatedSubnetId string = ''

@description('Private DNS zone resource ID. Required when networkMode is Private.')
param privateDnsZoneId string = ''

@description('Optional firewall rules to create when networkMode is Public. Each item should include name, startIpAddress, and endIpAddress.')
param publicFirewallRules array = []

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    version: '16'
    availabilityZone: '1'
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
      tier: 'P4'
    }
    network: {
      delegatedSubnetResourceId: networkMode == 'Private' ? delegatedSubnetId : null
      privateDnsZoneArmResourceId: networkMode == 'Private' ? privateDnsZoneId : null
      publicNetworkAccess: networkMode == 'Private' ? 'Disabled' : 'Enabled'
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  name: databaseName
  parent: postgresServer
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (networkMode == 'Public') {
  name: 'AllowAzureServices'
  parent: postgresServer
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource customPublicFirewallRules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [for rule in publicFirewallRules: if (networkMode == 'Public') {
  name: rule.name
  parent: postgresServer
  properties: {
    startIpAddress: rule.startIpAddress
    endIpAddress: rule.endIpAddress
  }
}]

output postgresServerId string = postgresServer.id
output postgresFqdn string = postgresServer.properties.fullyQualifiedDomainName
