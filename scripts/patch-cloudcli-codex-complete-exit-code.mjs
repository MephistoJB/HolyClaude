import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';

const DEFAULT_CLOUDCLI_ROOT = '/usr/local/lib/node_modules/@cloudcli-ai/cloudcli';
const cliTarget = process.argv[2];
const ERROR_MESSAGE = '[patch] ERROR: CloudCLI Codex complete exitCode anchors not found';

const completeEventWithExitCodePattern = /kind:\s*['"]complete['"],\s*\r?\n\s*exitCode:\s*0,\s*\r?\n\s*actualSessionId:\s*capturedSessionId\s*\|\|\s*thread\.id\s*\|\|\s*sessionId\s*\|\|\s*null,\s*\r?\n\s*sessionId:\s*capturedSessionId\s*\|\|\s*sessionId\s*\|\|\s*null,\s*\r?\n\s*provider:\s*['"]codex['"]/m;

const completeEventWithoutExitCodePattern = /(^\s*kind:\s*['"]complete['"],\s*\r?\n)(\s*)actualSessionId:\s*capturedSessionId\s*\|\|\s*thread\.id\s*\|\|\s*sessionId\s*\|\|\s*null,/m;

function resolveTargets() {
  if (cliTarget && existsSync(cliTarget) && statSync(cliTarget).isFile()) {
    return [{ label: 'target', path: cliTarget }];
  }

  const root = cliTarget || DEFAULT_CLOUDCLI_ROOT;
  const targets = [
    { label: 'source', path: `${root}/server/openai-codex.js` },
    { label: 'runtime', path: `${root}/dist-server/server/openai-codex.js` }
  ];
  const missingTargets = targets.filter((target) => !existsSync(target.path));

  if (missingTargets.length > 0) {
    console.error(`${ERROR_MESSAGE}: missing ${missingTargets.map((target) => target.path).join(', ')}`);
    process.exit(1);
  }

  return targets;
}

function patchTarget(target) {
  let source = readFileSync(target.path, 'utf8');

  if (completeEventWithExitCodePattern.test(source)) {
    console.log(`[patch] CloudCLI Codex complete exitCode already present (${target.label})`);
    return;
  }

  if (!completeEventWithoutExitCodePattern.test(source)) {
    console.error(ERROR_MESSAGE);
    process.exit(1);
  }

  source = source.replace(
    completeEventWithoutExitCodePattern,
    (_, kindLine, indent) => `${kindLine}${indent}exitCode: 0,\n${indent}actualSessionId: capturedSessionId || thread.id || sessionId || null,`
  );

  if (!completeEventWithExitCodePattern.test(source)) {
    console.error(ERROR_MESSAGE);
    process.exit(1);
  }

  writeFileSync(target.path, source);
  console.log(`[patch] CloudCLI Codex complete exitCode applied (${target.label})`);
}

const targets = resolveTargets();
if (targets.length === 0) {
  console.error(ERROR_MESSAGE);
  process.exit(1);
}

for (const target of targets) {
  patchTarget(target);
}
