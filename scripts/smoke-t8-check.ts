import { buildApp } from '../apps/server/src/app.js';
import { ACCESS_COOKIE_NAME } from '../apps/server/src/auth/cookies.js';
import { signAccessToken } from '../apps/server/src/auth/token.js';
import { pool } from '../apps/server/src/db/index.js';

type Json = Record<string, unknown>;

function fail(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function pass(name: string): void {
  console.log(`PASS  ${name}`);
}

const { rows } = await pool.query<{ id: string; email: string }>(`
  SELECT u.id, u.email
  FROM users u
  WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = u.id)
    AND EXISTS (SELECT 1 FROM llm_usage_logs l WHERE l.user_id = u.id)
    AND EXISTS (SELECT 1 FROM agent_executions e WHERE e.user_id = u.id)
  ORDER BY u.created_at DESC
  LIMIT 1
`);

const user = rows[0];
if (!user) fail('no user with jobs + usage logs + agent executions');
pass(`found user ${user.email}`);

const app = await buildApp();
try {
  const signed = app.signCookie(signAccessToken(user.id));
  const cookieHeader = `${ACCESS_COOKIE_NAME}=${encodeURIComponent(signed)}`;

  const unauth = await app.inject({ method: 'GET', url: '/api/admin/jobs' });
  if (unauth.statusCode !== 401) fail(`unauth jobs status=${String(unauth.statusCode)}`);
  pass('GET /api/admin/jobs without cookie is 401');

  async function get(path: string): Promise<{ status: number; body: Json }> {
    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { cookie: cookieHeader },
    });
    let body: Json = {};
    try {
      body = res.json() as Json;
    } catch {
      body = { raw: res.body };
    }
    return { status: res.statusCode, body };
  }

  const jobs = await get('/api/admin/jobs?page=1');
  if (jobs.status !== 200) fail(`jobs status=${String(jobs.status)} body=${JSON.stringify(jobs.body)}`);
  const jobItems = Array.isArray(jobs.body['items']) ? jobs.body['items'] : [];
  const jobTotal = Number(jobs.body['total'] ?? 0);
  if (jobTotal <= 0 || jobItems.length === 0) fail('jobs list is empty');
  pass(`jobs total=${String(jobTotal)} items=${String(jobItems.length)}`);

  const usage = await get('/api/admin/usage/summary?days=30');
  if (usage.status !== 200) fail(`usage status=${String(usage.status)}`);
  const totals = (usage.body['totals'] ?? {}) as Json;
  const byModel = Array.isArray(usage.body['byModel']) ? usage.body['byModel'] : [];
  const daily = Array.isArray(usage.body['daily']) ? usage.body['daily'] : [];
  const totalTokens = Number(totals['totalTokens'] ?? 0);
  if (totalTokens <= 0 && byModel.length === 0) fail('usage summary is empty');
  pass(
    `usage tokens=${String(totalTokens)} models=${String(byModel.length)} days=${String(daily.length)} cost=${String(totals['costEstimate'] ?? 0)}`,
  );

  const execs = await get('/api/admin/executions?page=1');
  if (execs.status !== 200) fail(`executions status=${String(execs.status)}`);
  const execItems = Array.isArray(execs.body['items']) ? (execs.body['items'] as Json[]) : [];
  const execTotal = Number(execs.body['total'] ?? 0);
  if (execTotal <= 0 || execItems.length === 0) fail('executions list is empty');
  pass(`executions total=${String(execTotal)} items=${String(execItems.length)}`);

  const first = execItems[0];
  const firstId = typeof first?.['id'] === 'string' ? first['id'] : '';
  if (!firstId) fail('execution item missing id');
  const detail = await get(`/api/admin/executions/${firstId}`);
  if (detail.status !== 200) fail(`execution detail status=${String(detail.status)}`);
  const steps = Array.isArray(detail.body['steps']) ? detail.body['steps'] : [];
  pass(
    `execution ${firstId} steps=${String(steps.length)} summary=${String(detail.body['resultSummary'] ?? '')}`,
  );

  console.log(
    JSON.stringify(
      {
        user: user.email,
        jobs: { total: jobTotal, sampleType: (jobItems[0] as Json | undefined)?.['type'] },
        usage: {
          totalTokens,
          costEstimate: totals['costEstimate'],
          byCapability: (totals['byCapability'] as Json | undefined) ?? {},
        },
        execution: {
          id: firstId,
          agentType: detail.body['agentType'],
          status: detail.body['status'],
          stepCount: detail.body['stepCount'],
          steps: steps.length,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await pool.end();
}
