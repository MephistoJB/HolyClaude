import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';

const DEFAULT_CLOUDCLI_ROOT = '/usr/local/lib/node_modules/@cloudcli-ai/cloudcli';
const cliTarget = process.argv[2];
const ERROR_MESSAGE = '[patch] ERROR: CloudCLI worker-api anchors not found';
const ROUTE_RELATIVE_PATH = 'routes/worker.js';

const workerRouteSource = `import express from 'express';
import { spawn } from 'child_process';

import { apiKeysDb, projectsDb, sessionsDb } from '../modules/database/index.js';
import { sessionsService } from '../modules/providers/services/sessions.service.js';
import { providerModelsService } from '../modules/providers/services/provider-models.service.js';
import { authenticateToken } from '../middleware/auth.js';
import { abortClaudeSDKSession, isClaudeSDKSessionActive } from '../claude-sdk.js';
import { abortCursorSession, isCursorSessionActive } from '../cursor-cli.js';
import { abortCodexSession, isCodexSessionActive } from '../openai-codex.js';
import { abortGeminiSession, isGeminiSessionActive } from '../gemini-cli.js';
import { abortOpenCodeSession, isOpenCodeSessionActive } from '../opencode-cli.js';

const router = express.Router();
const PROVIDERS = new Set(['claude', 'cursor', 'codex', 'gemini', 'opencode']);

function readString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return fallback;
}

function readInt(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function readStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseProvider(value, fallback = 'claude') {
  const provider = readString(value, fallback) || fallback;
  if (!PROVIDERS.has(provider)) {
    throw new Error('provider must be one of claude, cursor, codex, gemini, opencode.');
  }
  return provider;
}

function authenticateWorkerRequest(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) {
    const user = apiKeysDb.validateApiKey(apiKey.trim());
    if (!user) {
      return res.status(401).json({ error: 'Invalid or inactive API key' });
    }
    req.user = user;
    return next();
  }

  return authenticateToken(req, res, next);
}

function parseSessionId(value) {
  const sessionId = readString(value);
  if (!sessionId) {
    throw new Error('sessionId is required.');
  }
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(sessionId)) {
    throw new Error('Invalid sessionId.');
  }
  return sessionId;
}

function resolveProjectPath(projectId, projectPath, sessionId = null) {
  const explicitPath = readString(projectPath);
  if (explicitPath) {
    return explicitPath;
  }

  const normalizedProjectId = readString(projectId);
  if (normalizedProjectId) {
    const byId = projectsDb.getProjectPathById(normalizedProjectId);
    if (byId) {
      return String(byId).trim();
    }
  }

  if (sessionId) {
    const session = sessionsDb.getSessionById(sessionId);
    if (session?.project_path) {
      return String(session.project_path).trim();
    }
  }

  return '';
}

function collectStrings(value, bucket = []) {
  if (value == null) {
    return bucket;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      bucket.push(trimmed);
    }
    return bucket;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, bucket);
    }
    return bucket;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'sessionId' || key === 'id' || key === 'uuid') {
        continue;
      }
      collectStrings(entry, bucket);
    }
  }
  return bucket;
}

async function normalizeWorkerResponse(agentResponse) {
  const content = [];
  if (Array.isArray(agentResponse?.messages)) {
    for (const entry of agentResponse.messages) {
      collectStrings(entry, content);
    }
  }

  if (content.length === 0 && agentResponse?.sessionId) {
    try {
      const history = await sessionsService.fetchHistory(agentResponse.sessionId, { limit: 200, offset: 0 });
      collectStrings(history, content);
    } catch {
    }
  }

  return {
    sessionId: agentResponse?.sessionId || null,
    projectPath: agentResponse?.projectPath || null,
    tokens: agentResponse?.tokens || null,
    branch: agentResponse?.branch || null,
    pullRequest: agentResponse?.pullRequest || null,
    resultText: content.join('\\n').trim(),
    raw: agentResponse
  };
}

async function proxyAgentRequest(userId, payload) {
  const apiKeyRecord = apiKeysDb.createApiKey(userId, 'worker-internal');
  try {
    const response = await fetch('http://127.0.0.1:' + (process.env.SERVER_PORT || 3001) + '/api/agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKeyRecord.apiKey
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      throw new Error((parsed && parsed.error) || text || ('Agent request failed with HTTP ' + response.status));
    }

    if (!parsed?.success) {
      throw new Error((parsed && parsed.error) || 'Agent response missing success=true');
    }

    return parsed;
  } finally {
    apiKeysDb.deleteApiKey(userId, apiKeyRecord.id);
  }
}

function getProviderAbortController(provider) {
  switch (provider) {
    case 'claude':
      return {
        abort: abortClaudeSDKSession,
        isActive: isClaudeSDKSessionActive
      };
    case 'cursor':
      return {
        abort: abortCursorSession,
        isActive: isCursorSessionActive
      };
    case 'codex':
      return {
        abort: abortCodexSession,
        isActive: isCodexSessionActive
      };
    case 'gemini':
      return {
        abort: abortGeminiSession,
        isActive: isGeminiSessionActive
      };
    case 'opencode':
      return {
        abort: abortOpenCodeSession,
        isActive: isOpenCodeSessionActive
      };
    default:
      throw new Error('Unsupported provider.');
  }
}

async function runValidationCommand(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (exitCode) => {
      resolve({
        command,
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        stdout,
        stderr
      });
    });
    child.on('error', (error) => {
      resolve({
        command,
        exitCode: 1,
        stdout,
        stderr: error.message
      });
    });
  });
}

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      role: 'worker',
      status: 'ok',
      providers: Array.from(PROVIDERS)
    }
  });
});

router.use(authenticateWorkerRequest);

router.get('/models/:provider', async (req, res) => {
  try {
    const provider = parseProvider(req.params.provider);
    const bypassCache = readBoolean(req.query.bypassCache, false);
    const result = await providerModelsService.getProviderModels(provider, { bypassCache });
    res.json({
      success: true,
      data: {
        provider,
        models: result.models,
        cache: result.cache
      }
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to load models' });
  }
});

router.post('/run', async (req, res) => {
  try {
    const provider = parseProvider(req.body?.provider);
    const prompt = readString(req.body?.prompt || req.body?.message);
    if (!prompt) {
      throw new Error('prompt is required.');
    }

    const projectPath = resolveProjectPath(req.body?.projectId, req.body?.projectPath);
    if (!projectPath) {
      throw new Error('projectId or projectPath is required.');
    }

    const response = await proxyAgentRequest(req.user.id, {
      provider,
      model: readString(req.body?.model) || undefined,
      projectPath,
      message: prompt,
      stream: false,
      cleanup: false,
      githubUrl: readString(req.body?.githubUrl) || undefined,
      branchName: readString(req.body?.branchName) || undefined,
      createBranch: readBoolean(req.body?.createBranch, false),
      createPR: readBoolean(req.body?.createPR, false)
    });

    const normalized = await normalizeWorkerResponse(response);
    res.status(201).json({
      success: true,
      data: {
        provider,
        sessionId: normalized.sessionId,
        projectPath: normalized.projectPath || projectPath,
        tokens: normalized.tokens,
        resultText: normalized.resultText,
        branch: normalized.branch,
        pullRequest: normalized.pullRequest,
        raw: normalized.raw
      }
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to run worker task' });
  }
});

router.post('/sessions/:sessionId/resume', async (req, res) => {
  try {
    const sessionId = parseSessionId(req.params.sessionId);
    const prompt = readString(req.body?.prompt || req.body?.message);
    if (!prompt) {
      throw new Error('prompt is required.');
    }

    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const response = await proxyAgentRequest(req.user.id, {
      provider: session.provider,
      model: readString(req.body?.model) || undefined,
      projectPath: resolveProjectPath(null, req.body?.projectPath, sessionId),
      message: prompt,
      sessionId,
      stream: false,
      cleanup: false
    });

    const normalized = await normalizeWorkerResponse(response);
    res.json({
      success: true,
      data: {
        provider: session.provider,
        sessionId: normalized.sessionId || sessionId,
        projectPath: normalized.projectPath || session.project_path || null,
        tokens: normalized.tokens,
        resultText: normalized.resultText,
        raw: normalized.raw
      }
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to resume worker session' });
  }
});

router.get('/sessions/:sessionId/messages', async (req, res) => {
  try {
    const sessionId = parseSessionId(req.params.sessionId);
    const limit = Math.max(0, readInt(req.query.limit, 200));
    const offset = Math.max(0, readInt(req.query.offset, 0));
    const result = await sessionsService.fetchHistory(sessionId, {
      limit,
      offset
    });
    res.json({
      success: true,
      data: {
        sessionId,
        messages: result
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load session messages';
    const statusCode = message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: message });
  }
});

router.post('/sessions/:sessionId/cancel', async (req, res) => {
  try {
    const sessionId = parseSessionId(req.params.sessionId);
    const provider = req.body?.provider
      ? parseProvider(req.body.provider)
      : (() => {
          const session = sessionsDb.getSessionById(sessionId);
          if (!session?.provider) {
            throw new Error('provider is required when session metadata is unavailable.');
          }
          return parseProvider(session.provider);
        })();

    const controller = getProviderAbortController(provider);
    const success = provider === 'claude'
      ? await controller.abort(sessionId)
      : controller.abort(sessionId);

    res.json({
      success: true,
      data: {
        provider,
        sessionId,
        cancelled: Boolean(success)
      }
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to cancel session' });
  }
});

router.get('/sessions/:sessionId/status', (req, res) => {
  try {
    const sessionId = parseSessionId(req.params.sessionId);
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const controller = getProviderAbortController(session.provider);
    const isActive = Boolean(controller.isActive(sessionId));

    res.json({
      success: true,
      data: {
        sessionId,
        provider: session.provider,
        isActive,
        projectPath: session.project_path || null,
        customName: session.custom_name || null,
        updatedAt: session.updated_at || null
      }
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to load session status' });
  }
});

router.post('/validate', async (req, res) => {
  try {
    const commands = readStringArray(req.body?.commands);
    if (commands.length === 0) {
      throw new Error('commands must contain at least one command.');
    }

    const sessionId = readString(req.body?.sessionId);
    const projectPath = resolveProjectPath(req.body?.projectId, req.body?.projectPath, sessionId || null);
    if (!projectPath) {
      throw new Error('projectId, projectPath, or sessionId is required.');
    }

    const results = [];
    for (const command of commands.slice(0, 50)) {
      results.push(await runValidationCommand(command, projectPath));
    }

    res.json({
      success: true,
      data: {
        projectPath,
        results
      }
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to run validation commands' });
  }
});

export default router;
`;

function resolveRoots() {
  if (cliTarget && existsSync(cliTarget) && statSync(cliTarget).isDirectory()) {
    return [{ label: 'target', root: cliTarget }];
  }

  const root = cliTarget || DEFAULT_CLOUDCLI_ROOT;
  return [{ label: 'cloudcli', root }];
}

function ensureRouteFiles(root) {
  const targets = [
    `${root}/server/${ROUTE_RELATIVE_PATH}`,
    `${root}/dist-server/server/${ROUTE_RELATIVE_PATH}`
  ];

  for (const target of targets) {
    const dir = target.slice(0, target.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, workerRouteSource);
  }
}

function patchIndexFile(indexPath) {
  let source = readFileSync(indexPath, 'utf8');

  if (!source.includes("import agentRoutes from './routes/agent.js';") || !source.includes("app.use('/api/agent', agentRoutes);")) {
    throw new Error(ERROR_MESSAGE);
  }

  if (!source.includes("import workerRoutes from './routes/worker.js';")) {
    source = source.replace(
      "import agentRoutes from './routes/agent.js';\n",
      "import agentRoutes from './routes/agent.js';\nimport workerRoutes from './routes/worker.js';\n"
    );
  }

  if (!source.includes("app.use('/api/worker', workerRoutes);")) {
    source = source.replace(
      "app.use('/api/agent', agentRoutes);\n",
      "app.use('/api/agent', agentRoutes);\napp.use('/api/worker', workerRoutes);\n"
    );
  }

  if (!source.includes("app.use('/api/worker', workerRoutes);")) {
    throw new Error(ERROR_MESSAGE);
  }

  writeFileSync(indexPath, source);
}

for (const { label, root } of resolveRoots()) {
  const runtimeIndex = `${root}/dist-server/server/index.js`;
  const sourceIndex = `${root}/server/index.js`;

  if (!existsSync(runtimeIndex) || !existsSync(sourceIndex)) {
    throw new Error(ERROR_MESSAGE);
  }

  ensureRouteFiles(root);
  patchIndexFile(sourceIndex);
  patchIndexFile(runtimeIndex);
  console.log(`[patch] CloudCLI worker API applied (${label})`);
}
