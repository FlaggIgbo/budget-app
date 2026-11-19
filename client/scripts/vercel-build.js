const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// Parse simple KEY=VALUE lines from .env files without overwriting existing process.env values
function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Resolve Angular build configuration ("development" vs "production") from .env / Vercel env vars
function resolveAngularBuildConfig() {
  const clientDir = path.resolve(__dirname, '..');
  const rootDir = path.resolve(clientDir, '..');

  // Check client-local .env files first, then repo root .env
  loadDotEnvFile(path.join(clientDir, '.env.local'));
  loadDotEnvFile(path.join(clientDir, '.env'));
  loadDotEnvFile(path.join(rootDir, '.env.local'));
  loadDotEnvFile(path.join(rootDir, '.env'));

  const vercelEnv = (process.env.VERCEL_ENV || '').trim().toLowerCase();
  // Always enforce Angular production build for Vercel Production deployments
  if (vercelEnv === 'production' || vercelEnv === 'prod') {
    return 'production';
  }

  const explicitEnv = (process.env.ENV || process.env.env || '').trim().toLowerCase();
  if (explicitEnv === 'production' || explicitEnv === 'prod') {
    return 'production';
  }
  if (explicitEnv === 'development' || explicitEnv === 'dev' || explicitEnv === 'preview') {
    return 'development';
  }

  if (vercelEnv === 'development' || vercelEnv === 'dev' || vercelEnv === 'preview') {
    return 'development';
  }

  // Safe default for unconfigured deployments
  return 'production';
}

function main() {
  const config = resolveAngularBuildConfig();
  console.log(
    `[vercel-build] Resolved environment="${config}" (ENV=${process.env.ENV || process.env.env || 'unset'}, VERCEL_ENV=${process.env.VERCEL_ENV || 'unset'})`
  );
  execSync(`npx ng build --configuration ${config}`, {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  loadDotEnvFile,
  resolveAngularBuildConfig,
};
