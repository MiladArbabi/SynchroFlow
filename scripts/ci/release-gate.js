#!/usr/bin/env node
// SF-CI-CUTOVER-ISOLATION-001 — Fly release gate. Refuses unless the exact
// release commit has the required CI evidence:
//
//   1. General CI: a completed `CI / RLS Security Boundary` run on main for
//      EXPECTED_SHA itself whose rls-security job and every one of its steps
//      succeeded (no skipped or partial step).
//   2. Cutover CI, only when the release range changes shipped cutover-
//      sensitive code (cutover-impact.js --mode=release from the last
//      successful Fly deploy):
//      a successful `Opening inventory cutover verification` job on main for
//      a commit C that is EXPECTED_SHA or its ancestor, with no cutover-
//      affecting change in C...EXPECTED_SHA.
//
// Missing, failed, cancelled, partial or unresolvable evidence refuses.
// Pull-request and non-main runs never count.
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CI_WORKFLOW = 'ci-security.yml';
const DEPLOY_WORKFLOW = 'fly-deploy.yml';
const GENERAL_JOB = 'rls-security';
const CUTOVER_JOB = 'Opening inventory cutover verification';
const CUTOVER_STEP = 'Run S4-5 I4 cutover inclusion and opening inventory cutover regressions';
const MAIN_EVENTS = new Set(['push', 'workflow_dispatch']);
const CUTOVER_CANDIDATE_LIMIT = 30;

const isMainRun = (run) => run.head_branch === 'main' && MAIN_EVENTS.has(run.event) && run.status === 'completed';

async function generalEvidence(api, sha) {
  const runs = (await api.workflowRuns(CI_WORKFLOW, { head_sha: sha })).filter(isMainRun);
  for (const run of runs) {
    const job = (await api.runJobs(run.id)).find((j) => j.name === GENERAL_JOB);
    if (job && job.conclusion === 'success' && job.steps.length > 0 && job.steps.every((s) => s.conclusion === 'success')) {
      return run;
    }
  }
  return null;
}

async function cutoverEvidence(api, git, classify, sha) {
  const runs = (await api.workflowRuns(CI_WORKFLOW, { branch: 'main' })).filter(isMainRun);
  let checked = 0;
  for (const run of runs) {
    if (!git.isAncestor(run.head_sha, sha)) continue;
    if (++checked > CUTOVER_CANDIDATE_LIMIT) break;
    const job = (await api.runJobs(run.id)).find((j) => j.name === CUTOVER_JOB);
    const step = job && job.steps.find((s) => s.name === CUTOVER_STEP);
    if (!job || job.conclusion !== 'success' || !step || step.conclusion !== 'success') continue;
    if (run.head_sha === sha || classify(run.head_sha, sha) === false) return run;
  }
  return null;
}

async function lastDeployedSha(api, git, sha) {
  const runs = await api.workflowRuns(DEPLOY_WORKFLOW, { branch: 'main', status: 'success' });
  const run = runs.find((r) => r.conclusion === 'success');
  if (!run) return { base: null, note: 'no successful Fly deploy found' };
  if (!git.isAncestor(run.head_sha, sha)) return { base: null, note: `last deploy ${run.head_sha} is not an ancestor` };
  return { base: run.head_sha, note: `last deploy run ${run.id}` };
}

// Returns { ok, lines }. Never throws for evidence problems: they refuse.
async function evaluate({ api, git, classify, sha }) {
  const lines = [];
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, lines: [`REFUSE expected SHA is not a full SHA: ${sha}`] };

  const general = await generalEvidence(api, sha);
  if (!general) return { ok: false, lines: [`REFUSE no fully successful ${GENERAL_JOB} job on main for ${sha}`] };
  lines.push(`GENERAL_CI=PASS run=${general.id} event=${general.event}`);

  const { base, note } = await lastDeployedSha(api, git, sha);
  const required = base === null ? true : classify(base, sha) !== false;
  lines.push(`CUTOVER_BASE=${base || 'UNKNOWN'} (${note}) CUTOVER_REQUIRED=${required}`);
  if (!required) return { ok: true, lines: [...lines, 'CUTOVER_CI=NOT_REQUIRED'] };

  const cutover = await cutoverEvidence(api, git, classify, sha);
  if (!cutover) return { ok: false, lines: [...lines, `REFUSE no successful cutover verification on main covering ${sha}`] };
  return { ok: true, lines: [...lines, `CUTOVER_CI=PASS run=${cutover.id} commit=${cutover.head_sha}`] };
}

function githubApi(repository, token) {
  const request = async (url) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${url}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url}`);
    return response.json();
  };
  return {
    async workflowRuns(workflow, filters) {
      const query = new URLSearchParams({ ...filters, per_page: '100' });
      return (await request(`actions/workflows/${workflow}/runs?${query}`)).workflow_runs;
    },
    async runJobs(runId) {
      return (await request(`actions/runs/${runId}/jobs?filter=latest&per_page=100`)).jobs;
    },
  };
}

const localGit = {
  isAncestor(ancestor, sha) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', ancestor, sha], { cwd: ROOT, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },
};

// true | false; anything unexpected is true (fail closed).
function localClassify(base, head) {
  try {
    const out = execFileSync('node', [path.join(__dirname, 'cutover-impact.js'), '--mode=release', base, head], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(out.replace(/^/gm, '  '));
    return !/^CUTOVER_REQUIRED=false$/m.test(out);
  } catch {
    return true;
  }
}

async function main() {
  const { EXPECTED_SHA, GITHUB_REPOSITORY, GH_TOKEN } = process.env;
  let result;
  try {
    if (!GITHUB_REPOSITORY || !GH_TOKEN) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required');
    result = await evaluate({ api: githubApi(GITHUB_REPOSITORY, GH_TOKEN), git: localGit, classify: localClassify, sha: EXPECTED_SHA || '' });
  } catch (error) {
    result = { ok: false, lines: [`REFUSE gate error: ${error.message}`] };
  }
  for (const line of result.lines) console.log(line);
  console.log(`RELEASE_GATE=${result.ok ? 'PASS' : 'REFUSED'}`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { evaluate, GENERAL_JOB, CUTOVER_JOB, CUTOVER_STEP };
