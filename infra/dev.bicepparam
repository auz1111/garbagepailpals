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

// API configuration. Secret values come from env vars at deploy time (GitHub
// Actions secrets), never committed. Dev defaults to sandbox PayPal and fake
// entitlements for easy local-style testing.
param jwtAccessSecret = readEnvironmentVariable('JWT_ACCESS_SECRET_DEV', '')
param jwtRefreshSecret = readEnvironmentVariable('JWT_REFRESH_SECRET_DEV', '')
param stripeSecretKey = readEnvironmentVariable('STRIPE_SECRET_KEY_DEV', '')
param stripeWebhookSecret = readEnvironmentVariable('STRIPE_WEBHOOK_SECRET_DEV', '')
param paypalClientId = readEnvironmentVariable('PAYPAL_CLIENT_ID_DEV', '')
param paypalClientSecret = readEnvironmentVariable('PAYPAL_CLIENT_SECRET_DEV', '')
param paypalWebhookId = readEnvironmentVariable('PAYPAL_WEBHOOK_ID_DEV', '')
param orsApiKey = readEnvironmentVariable('ORS_API_KEY_DEV', '')
param googleGeocodingApiKey = readEnvironmentVariable('GOOGLE_GEOCODING_API_KEY_DEV', '')
param paypalEnv = 'sandbox'
param devFakeEntitlement = 'true'
