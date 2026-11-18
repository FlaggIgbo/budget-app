// Default / Localhost Development Environment Configuration
// Supports testing against Plaid's 'sandbox' or 'development' environment on localhost
export const environment = {
  name: 'development' as 'development' | 'production',
  production: false,
  apiUrl: '/api',
  supportedPlaidEnvironments: ['sandbox', 'development'],
  storageProvider: 'minio',
  sentryDsn: '',
};
