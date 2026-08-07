using './main.bicep'

param environment = 'dev'
param location = 'westus2'
param namePrefix = 'gpp'
param postgresAdminLogin = 'gppadmin'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD_DEV', 'replace-before-deploy')
param postgresNetworkMode = 'Private'
param vnetAddressPrefix = '10.30.0.0/16'
param postgresSubnetPrefix = '10.30.1.0/24'
param functionSubnetPrefix = '10.30.2.0/24'
