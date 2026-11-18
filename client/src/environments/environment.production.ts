// Production Environment Configuration
export const environment = {
  name: 'production' as 'development' | 'production',
  production: true,
  apiUrl: '/api',
  supportedPlaidEnvironments: ['production'],
  storageProvider: 'r2',
  sentryDsn: '',
};
