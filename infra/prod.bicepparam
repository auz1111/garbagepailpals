using './main.bicep'

param environment = 'prod'
param location = 'westus2'
param namePrefix = 'gpp'
param cheapMode = true
param postgresAdminLogin = 'gppadmin'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD_PROD', 'replace-before-deploy')
param postgresNetworkMode = 'Private'
param vnetAddressPrefix = '10.40.0.0/16'
param postgresSubnetPrefix = '10.40.1.0/24'
param functionSubnetPrefix = '10.40.2.0/24'

// API configuration. Secret values come from env vars at deploy time (set as
// GitHub Actions secrets), never committed. An unset secret falls back to '' and
// is simply omitted from the Function App's settings.
param jwtAccessSecret = readEnvironmentVariable('JWT_ACCESS_SECRET_PROD', '')
param jwtRefreshSecret = readEnvironmentVariable('JWT_REFRESH_SECRET_PROD', '')
param stripeSecretKey = readEnvironmentVariable('STRIPE_SECRET_KEY_PROD', '')
param stripeWebhookSecret = readEnvironmentVariable('STRIPE_WEBHOOK_SECRET_PROD', '')
param paypalClientId = readEnvironmentVariable('PAYPAL_CLIENT_ID_PROD', '')
param paypalClientSecret = readEnvironmentVariable('PAYPAL_CLIENT_SECRET_PROD', '')
param paypalWebhookId = readEnvironmentVariable('PAYPAL_WEBHOOK_ID_PROD', '')
param orsApiKey = readEnvironmentVariable('ORS_API_KEY_PROD', '')
param googleGeocodingApiKey = readEnvironmentVariable('GOOGLE_GEOCODING_API_KEY_PROD', '')
param paypalEnv = 'live'
param devFakeEntitlement = 'false'
