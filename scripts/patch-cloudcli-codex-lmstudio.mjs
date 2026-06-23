import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';

const DEFAULT_CLOUDCLI_ROOT = '/usr/local/lib/node_modules/@cloudcli-ai/cloudcli';
const cliTarget = process.argv[2];
const ERROR_MESSAGE = '[patch] ERROR: CloudCLI Codex LM Studio anchors not found';
const PATCH_MARKER = 'const HOLYCLAUDE_CODEX_LMSTUDIO_PATCH = true;';

const settingsImports = `import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';
`;

const settingsHelpers = `
const HOLYCLAUDE_CODEX_LMSTUDIO_PATCH = true;
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
const HOLYCLAUDE_CODEX_BASE_URL_ENV_NAMES = ['HOLYCLAUDE_CODEX_BASE_URL', 'CODEX_OSS_BASE_URL'];
const HOLYCLAUDE_CODEX_MODEL_ENV_NAMES = ['HOLYCLAUDE_CODEX_MODEL', 'CODEX_MODEL'];
const HOLYCLAUDE_CODEX_MODEL_PROVIDER = 'lmstudio';
const HOLYCLAUDE_CODEX_REMOTE_PROVIDER_ID = 'holyclaude_lmstudio';

function readFirstConfiguredEnvValue(envNames) {
  for (const envName of envNames) {
    const rawValue = process.env[envName];
    if (rawValue == null) {
      continue;
    }

    const normalizedValue = String(rawValue).trim();
    if (normalizedValue !== '') {
      return normalizedValue;
    }
  }

  return null;
}

function normalizeCodexBaseUrl(rawValue) {
  const normalizedValue = String(rawValue ?? '').trim();
  if (normalizedValue === '') {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedValue);
  } catch {
    const error = new Error('Base URL must be a valid absolute URL.');
    error.statusCode = 400;
    throw error;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    const error = new Error('Base URL must start with http:// or https://');
    error.statusCode = 400;
    throw error;
  }

  let pathname = parsedUrl.pathname.replace(/\\/+$/, '');
  if (pathname === '') {
    pathname = '/v1';
  } else if (pathname !== '/v1' && !pathname.endsWith('/v1')) {
    pathname = pathname === '/' ? '/v1' : \`\${pathname}/v1\`;
  }

  parsedUrl.pathname = pathname;
  parsedUrl.search = '';
  parsedUrl.hash = '';

  return parsedUrl.toString().replace(/\\/$/, '');
}

async function readCodexConfig() {
  try {
    const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
    const parsed = TOML.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeCodexConfig(config) {
  const serialized = TOML.stringify(config);
  await writeFile(CODEX_CONFIG_PATH, serialized.endsWith('\\n') ? serialized : \`\${serialized}\\n\`, 'utf8');
}

function mapLmStudioModelOption(model) {
  const value = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!value) {
    return null;
  }

  const ownedBy = typeof model?.owned_by === 'string' && model.owned_by.trim() !== ''
    ? model.owned_by.trim()
    : null;
  const objectType = typeof model?.object === 'string' && model.object.trim() !== ''
    ? model.object.trim()
    : null;
  const descriptionParts = [ownedBy, objectType].filter(Boolean);

  return {
    value,
    label: value,
    description: descriptionParts.length > 0 ? descriptionParts.join(' · ') : undefined,
  };
}

async function fetchLmStudioModels(baseUrl) {
  const normalizedBaseUrl = normalizeCodexBaseUrl(baseUrl);
  const response = await fetch(\`\${normalizedBaseUrl}/models\`);
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    const error = new Error(\`LM Studio returned HTTP \${response.status}\${responseText ? \`: \${responseText.slice(0, 200)}\` : ''}\`);
    error.statusCode = 502;
    throw error;
  }

  const payload = await response.json();
  const rawModels = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  const options = [];
  const seenValues = new Set();

  for (const model of rawModels) {
    const mappedModel = mapLmStudioModelOption(model);
    if (!mappedModel || seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  return {
    options,
    defaultModel: options[0]?.value ?? null,
    normalizedBaseUrl,
  };
}

async function buildCodexLmStudioSettingsResponse() {
  const config = await readCodexConfig();
  const savedProviderConfig = config?.model_providers && typeof config.model_providers === 'object'
    ? config.model_providers[HOLYCLAUDE_CODEX_REMOTE_PROVIDER_ID]
    : null;
  const savedBaseUrl = typeof savedProviderConfig?.base_url === 'string' && savedProviderConfig.base_url.trim() !== ''
    ? savedProviderConfig.base_url.trim()
    : typeof config?.openai_base_url === 'string' && config.openai_base_url.trim() !== ''
      ? config.openai_base_url.trim()
      : null;
  const savedModel = typeof config?.model === 'string' && config.model.trim() !== ''
    ? config.model.trim()
    : null;
  const envBaseUrl = readFirstConfiguredEnvValue(HOLYCLAUDE_CODEX_BASE_URL_ENV_NAMES);
  const envModel = readFirstConfiguredEnvValue(HOLYCLAUDE_CODEX_MODEL_ENV_NAMES);
  const effectiveBaseUrl = envBaseUrl ? normalizeCodexBaseUrl(envBaseUrl) : savedBaseUrl;
  const effectiveModel = envModel ?? savedModel;

  return {
    configPath: CODEX_CONFIG_PATH,
    saved: {
      modelProvider: typeof config?.model_provider === 'string' ? config.model_provider : null,
      ossProvider: typeof config?.oss_provider === 'string' ? config.oss_provider : null,
      baseUrl: savedBaseUrl,
      model: savedModel,
    },
    env: {
      baseUrl: envBaseUrl ? normalizeCodexBaseUrl(envBaseUrl) : null,
      model: envModel,
      baseUrlEnvName: envBaseUrl
        ? HOLYCLAUDE_CODEX_BASE_URL_ENV_NAMES.find((envName) => {
            const value = process.env[envName];
            return value != null && String(value).trim() !== '';
          }) ?? null
        : null,
      modelEnvName: envModel
        ? HOLYCLAUDE_CODEX_MODEL_ENV_NAMES.find((envName) => {
            const value = process.env[envName];
            return value != null && String(value).trim() !== '';
          }) ?? null
        : null,
    },
    effective: {
      modelProvider: HOLYCLAUDE_CODEX_MODEL_PROVIDER,
      baseUrl: effectiveBaseUrl,
      model: effectiveModel,
    },
  };
}
`;

const settingsRoutes = `
router.get('/codex-lmstudio', async (req, res) => {
  try {
    const settings = await buildCodexLmStudioSettingsResponse();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error reading Codex LM Studio settings:', error);
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to load Codex LM Studio settings' });
  }
});

router.post('/codex-lmstudio/models', async (req, res) => {
  try {
    const providedBaseUrl = typeof req.body?.baseUrl === 'string' && req.body.baseUrl.trim() !== ''
      ? req.body.baseUrl
      : null;
    const settings = await buildCodexLmStudioSettingsResponse();
    const baseUrl = providedBaseUrl ?? settings.effective.baseUrl ?? settings.saved.baseUrl;
    if (!baseUrl) {
      return res.status(400).json({ error: 'LM Studio base URL is required before models can be loaded.' });
    }

    const result = await fetchLmStudioModels(baseUrl);
    res.json({
      success: true,
      data: {
        baseUrl: result.normalizedBaseUrl,
        options: result.options,
        defaultModel: result.defaultModel,
      },
    });
  } catch (error) {
    console.error('Error loading Codex LM Studio models:', error);
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to load LM Studio models' });
  }
});

router.put('/codex-lmstudio', async (req, res) => {
  try {
    const baseUrl = normalizeCodexBaseUrl(req.body?.baseUrl);
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';

    if (!baseUrl) {
      return res.status(400).json({ error: 'LM Studio base URL is required.' });
    }

    if (!model) {
      return res.status(400).json({ error: 'Codex model is required.' });
    }

    const config = await readCodexConfig();
    const nextConfig = {
      ...config,
      model_provider: HOLYCLAUDE_CODEX_REMOTE_PROVIDER_ID,
      model,
      model_providers: {
        ...(config?.model_providers && typeof config.model_providers === 'object' ? config.model_providers : {}),
        [HOLYCLAUDE_CODEX_REMOTE_PROVIDER_ID]: {
          name: 'LM Studio (HolyClaude)',
          base_url: baseUrl,
          wire_api: 'responses',
        },
      },
    };

    delete nextConfig.oss_provider;
    delete nextConfig.openai_base_url;

    await writeCodexConfig(nextConfig);
    const settings = await buildCodexLmStudioSettingsResponse();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error saving Codex LM Studio settings:', error);
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to save Codex LM Studio settings' });
  }
});
`;

const codexModelsHelpers = `
const HOLYCLAUDE_CODEX_LMSTUDIO_PATCH = true;
const HOLYCLAUDE_CODEX_BASE_URL_ENV_NAMES = ['HOLYCLAUDE_CODEX_BASE_URL', 'CODEX_OSS_BASE_URL'];
const HOLYCLAUDE_CODEX_MODEL_ENV_NAMES = ['HOLYCLAUDE_CODEX_MODEL', 'CODEX_MODEL'];
const HOLYCLAUDE_CODEX_REMOTE_PROVIDER_ID = 'holyclaude_lmstudio';

const readConfiguredCodexEnvValue = (envNames) => {
  for (const envName of envNames) {
    const rawValue = process.env[envName];
    if (rawValue == null) {
      continue;
    }

    const normalizedValue = String(rawValue).trim();
    if (normalizedValue !== '') {
      return normalizedValue;
    }
  }

  return null;
};

const normalizeCodexBaseUrl = (rawValue) => {
  const normalizedValue = String(rawValue ?? '').trim();
  if (normalizedValue === '') {
    return null;
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    let pathname = parsedUrl.pathname.replace(/\\/+$/, '');
    if (pathname === '') {
      pathname = '/v1';
    } else if (pathname !== '/v1' && !pathname.endsWith('/v1')) {
      pathname = pathname === '/' ? '/v1' : \`\${pathname}/v1\`;
    }

    parsedUrl.pathname = pathname;
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return parsedUrl.toString().replace(/\\/$/, '');
  } catch {
    return null;
  }
};

const isLmStudioModel = (value) => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.id));
};

const mapLmStudioModel = (model) => {
  const modelId = readOptionalString(model.id);
  if (!modelId) {
    return null;
  }

  const ownedBy = readOptionalString(model.owned_by);
  const objectType = readOptionalString(model.object);
  const descriptionParts = [ownedBy, objectType].filter(Boolean);

  return {
    value: modelId,
    label: modelId,
    description: descriptionParts.length > 0 ? descriptionParts.join(' · ') : undefined,
  };
};

const buildLmStudioModelsDefinition = (models) => {
  const options = [];
  const seenValues = new Set();

  for (const model of models) {
    const mappedModel = mapLmStudioModel(model);
    if (!mappedModel || seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CODEX_FALLBACK_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: options[0]?.value ?? CODEX_FALLBACK_MODELS.DEFAULT,
  };
};

const readCodexModelProviderConfig = async () => {
  try {
    const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
    const parsed = readObjectRecord(TOML.parse(raw));
    return parsed ?? {};
  } catch {
    return {};
  }
};

const resolveCodexModelProvider = async () => {
  const config = await readCodexModelProviderConfig();
  const envBaseUrl = normalizeCodexBaseUrl(readConfiguredCodexEnvValue(HOLYCLAUDE_CODEX_BASE_URL_ENV_NAMES));
  const envModel = readConfiguredCodexEnvValue(HOLYCLAUDE_CODEX_MODEL_ENV_NAMES);
  const savedModelProvider = readOptionalString(config?.model_provider);
  const savedBaseUrl = normalizeCodexBaseUrl(
    readOptionalString(config?.model_providers?.[HOLYCLAUDE_CODEX_REMOTE_PROVIDER_ID]?.base_url)
      || readOptionalString(config?.openai_base_url),
  );
  const savedModel = readOptionalString(config?.model);
  const effectiveBaseUrl = envBaseUrl ?? savedBaseUrl;
  const effectiveModel = envModel ?? savedModel;
  const effectiveModelProvider = envBaseUrl || envModel
    ? HOLYCLAUDE_CODEX_REMOTE_PROVIDER_ID
    : savedModelProvider;

  return {
    config,
    modelProvider: effectiveModelProvider,
    baseUrl: effectiveBaseUrl,
    model: effectiveModel,
  };
};

const fetchLmStudioModelsDefinition = async (baseUrl) => {
  const response = await fetch(\`\${baseUrl}/models\`);
  if (!response.ok) {
    throw new Error(\`LM Studio returned HTTP \${response.status}\`);
  }

  const payload = readObjectRecord(await response.json());
  const rawModels = Array.isArray(payload?.data)
    ? payload.data.filter(isLmStudioModel)
    : Array.isArray(payload?.models)
      ? payload.models.filter(isLmStudioModel)
      : [];

  return buildLmStudioModelsDefinition(rawModels);
};
`;

function resolveTargets() {
  if (cliTarget && existsSync(cliTarget) && statSync(cliTarget).isFile()) {
    return [{ label: 'target', path: cliTarget }];
  }

  const root = cliTarget || DEFAULT_CLOUDCLI_ROOT;
  return [
    { label: 'settings-source', path: `${root}/server/routes/settings.js`, kind: 'settings' },
    { label: 'settings-runtime', path: `${root}/dist-server/server/routes/settings.js`, kind: 'settings' },
    { label: 'codex-models-source', path: `${root}/server/modules/providers/list/codex/codex-models.provider.ts`, kind: 'codex-models' },
    { label: 'codex-models-runtime', path: `${root}/dist-server/server/modules/providers/list/codex/codex-models.provider.js`, kind: 'codex-models' },
    { label: 'index-html', path: `${root}/dist/index.html`, kind: 'index-html' },
  ].filter((target) => existsSync(target.path));
}

function patchSettingsRoute(source) {
  if (source.includes(PATCH_MARKER) && source.includes("/codex-lmstudio")) {
    return source;
  }

  if (!source.includes("import express from 'express';") || !source.includes('const router = express.Router();') || !source.includes('export default router;')) {
    throw new Error(ERROR_MESSAGE);
  }

  source = source.replace("import express from 'express';\n", `import express from 'express';\n${settingsImports}`);
  source = source.replace('const router = express.Router();\n', `const router = express.Router();\n${settingsHelpers}\n`);
  source = source.replace('\nexport default router;\n', `\n${settingsRoutes}\nexport default router;\n`);

  if (!source.includes(PATCH_MARKER) || !source.includes("router.get('/codex-lmstudio'") || !source.includes("router.put('/codex-lmstudio'")) {
    throw new Error(ERROR_MESSAGE);
  }

  return source;
}

function patchCodexModelsProvider(source) {
  if (source.includes(PATCH_MARKER) && source.includes('fetchLmStudioModelsDefinition')) {
    return source;
  }

  if (!source.includes("const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');")
    || !source.includes('async getSupportedModels()')
    || !source.includes('async getCurrentActiveModel()')) {
    throw new Error(ERROR_MESSAGE);
  }

  source = source.replace(
    "const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');\n",
    `const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');\n${codexModelsHelpers}\n`,
  );

  source = source.replace(
    /async getSupportedModels\(\)[\s\S]*?async getCurrentActiveModel\(\)/,
    `async getSupportedModels() {
    const providerConfig = await resolveCodexModelProvider();
    if (providerConfig.modelProvider === 'lmstudio' && providerConfig.baseUrl) {
      try {
        return await fetchLmStudioModelsDefinition(providerConfig.baseUrl);
      }
      catch (error) {
        console.warn('Unable to load LM Studio models for Codex provider:', error);
      }
    }
    try {
      const raw = await readFile(CODEX_MODELS_CACHE_PATH, 'utf8');
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];
      return buildCodexModelsDefinition(models);
    }
    catch {
      return CODEX_FALLBACK_MODELS;
    }
  }
    async getCurrentActiveModel()`,
  );

  source = source.replace(
    /async getCurrentActiveModel\(\)[\s\S]*?async changeActiveModel\(input\)/,
    `async getCurrentActiveModel() {
    try {
      const providerConfig = await resolveCodexModelProvider();
      if (providerConfig.model) {
        return {
          model: providerConfig.model,
        };
      }
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
    catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }
    async changeActiveModel(input)`,
  );

  if (!source.includes(PATCH_MARKER) || !source.includes("providerConfig.modelProvider === 'lmstudio'")) {
    throw new Error(ERROR_MESSAGE);
  }

  return source;
}

function patchIndexHtml(source) {
  const marker = '/assets/holyclaude-codex-lmstudio-settings.js';
  if (source.includes(marker)) {
    return source;
  }

  const anchor = '    <script type="module" crossorigin src="/assets/index-BIHaviaA.js"></script>\n';
  if (!source.includes(anchor)) {
    throw new Error(ERROR_MESSAGE);
  }

  source = source.replace(
    anchor,
    `    <script type="module" crossorigin src="${marker}"></script>\n${anchor}`,
  );

  if (!source.includes(marker)) {
    throw new Error(ERROR_MESSAGE);
  }

  return source;
}

function patchTarget(target) {
  let source = readFileSync(target.path, 'utf8');
  if (target.kind === 'settings') {
    source = patchSettingsRoute(source);
  } else if (target.kind === 'codex-models') {
    source = patchCodexModelsProvider(source);
  } else if (target.kind === 'index-html') {
    source = patchIndexHtml(source);
  } else {
    throw new Error(ERROR_MESSAGE);
  }

  writeFileSync(target.path, source);
  console.log(`[patch] CloudCLI Codex LM Studio patch applied (${target.label})`);
}

const targets = resolveTargets();
if (targets.length === 0) {
  console.error(ERROR_MESSAGE);
  process.exit(1);
}

for (const target of targets) {
  patchTarget(target);
}
