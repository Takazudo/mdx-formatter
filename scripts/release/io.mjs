// Side-effecting I/O for the release coordinator and gates. Tests pass a fake.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { npmRegistry } from './tags.mjs';

export class GitHubError extends Error {
  constructor(message, { status = null, body = '', acceptedPermissions = null, cause } = {}) {
    super(message, { cause });
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
    this.acceptedPermissions = acceptedPermissions;
  }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * GitHub REST over fetch. Uses GH_TOKEN/GITHUB_TOKEN when present (the job's
 * ephemeral token in Actions); without one it reads the public API only.
 */
export function githubClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const base = env.GITHUB_API_URL || 'https://api.github.com';
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || '';
  async function request(method, path, body) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mdx-formatter-release',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(`${base}/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // No status: the request may or may not have reached GitHub.
      throw new GitHubError(`${method} ${path}: no response (${error.message})`, { cause: error });
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      throw new GitHubError(
        `${method} ${path}: HTTP ${response.status} ${json?.message ?? text.slice(0, 200)}`,
        {
          status: response.status,
          body: text.slice(0, 2000),
          acceptedPermissions: response.headers.get('x-accepted-github-permissions'),
        },
      );
    }
    return { status: response.status, json };
  }
  return {
    request,
    async get(path) {
      try {
        return (await request('GET', path)).json;
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },
  };
}

export function createIo(env = process.env) {
  return {
    env,
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (...a) => console.log(...a),
    warn: (...a) => console.error(...a),
    git,
    gitOk(args) {
      try {
        git(args);
        return true;
      } catch {
        return false;
      }
    },
    /** Peeled commit of a remote tag, or null when the tag does not exist. Throws when unreadable. */
    remoteTagSha(tag) {
      const out = git(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
      const rows = out
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t'));
      const peeled = rows.find(([, ref]) => ref.endsWith('^{}'));
      const plain = rows.find(([, ref]) => ref === `refs/tags/${tag}`);
      return (peeled ?? plain)?.[0] ?? null;
    },
    github: githubClient({ env }),
    registry: npmRegistry(),
    setOutput(name, value) {
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
      console.log(`output ${name}=${value}`);
    },
    summary(markdown) {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    },
  };
}
