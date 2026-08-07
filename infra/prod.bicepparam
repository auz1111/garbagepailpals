using './main.bicep'

param environment = 'prod'
param location = 'westus2'
param namePrefix = 'gpp'
param postgresAdminLogin = 'gppadmin'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD_PROD', 'replace-before-deploy')
param postgresNetworkMode = 'Private'
param vnetAddressPrefix = '10.40.0.0/16'
param postgresSubnetPrefix = '10.40.1.0/24'
param functionSubnetPrefix = '10.40.2.0/24'
