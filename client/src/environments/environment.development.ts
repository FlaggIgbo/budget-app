// Localhost Development Environment Configuration
// Allows testing against Plaid 'sandbox' or Plaid 'development' while running locally
export const environment = {
  name: 'development' as 'development' | 'production',
  production: false,
  apiUrl: '/api',
  supportedPlaidEnvironments: ['sandbox', 'development'],
  storageProvider: 'minio',
  sentryDsn: '',
};
