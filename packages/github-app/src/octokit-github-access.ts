import type { DraftPrResult, GitHubAccess, PrRef, RepoTarget } from '@warden/core';
import { errorStatus, splitRepo, type OctokitLike } from './octokit-file-access.js';

const COMMIT_PREFIX = 'warden: sync coverage';
const CHECK_RUN_NAME = 'Warden Coverage Sync';

/**
 * A write-side {@link GitHubAccess} over the GitHub REST API.
 *
 * Every call goes through the injected {@link OctokitLike}, so the whole adapter
 * is exercised against a recording fake in unit tests — no real network. The three
 * operations map to:
 *
 * - `openOrUpdateDraftPr` — ensure the sync branch exists (created off the default
 *   branch when missing), commit each file over the contents API (`content: null`
 *   deletes), then open a **draft** PR or update the existing one for that branch.
 * - `addPrSuggestions` — post the proposed additions/edits as a comment on the
 *   source PR (a v1 stand-in for line-level review suggestions).
 * - `postCheckRun` — create a completed check run carrying the summary + conclusion.
 */
export function createOctokitGitHubAccess(octokit: OctokitLike): GitHubAccess {
  async function defaultBranch(owner: string, repo: string): Promise<string> {
    const res = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });
    return res.data?.default_branch ?? 'main';
  }

  async function branchSha(owner: string, repo: string, branch: string): Promise<string | null> {
    try {
      const res = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      return res.data?.object?.sha ?? null;
    } catch (err) {
      if (errorStatus(err) === 404) return null;
      throw err;
    }
  }

  async function fileSha(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    try {
      const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path,
        ref,
      });
      return res.data?.sha ?? null;
    } catch (err) {
      if (errorStatus(err) === 404) return null;
      throw err;
    }
  }

  return {
    async openOrUpdateDraftPr(
      repo: RepoTarget,
      branch: string,
      files: { path: string; content: string | null }[],
      title: string,
      body: string,
    ): Promise<DraftPrResult> {
      const { owner, repo: name } = splitRepo(repo);
      const base = await defaultBranch(owner, name);

      // Ensure the sync branch exists, creating it off the default branch's tip.
      if ((await branchSha(owner, name, branch)) === null) {
        const baseSha = await branchSha(owner, name, base);
        await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
          owner,
          repo: name,
          ref: `refs/heads/${branch}`,
          sha: baseSha,
        });
      }

      // Commit each file to the branch over the contents API.
      for (const file of files) {
        const existing = await fileSha(owner, name, file.path, branch);
        if (file.content === null) {
          if (existing === null) continue; // nothing to delete
          await octokit.request('DELETE /repos/{owner}/{repo}/contents/{path}', {
            owner,
            repo: name,
            path: file.path,
            message: `${COMMIT_PREFIX}: remove ${file.path}`,
            branch,
            sha: existing,
          });
        } else {
          await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
            owner,
            repo: name,
            path: file.path,
            message: `${COMMIT_PREFIX}: ${existing ? 'update' : 'add'} ${file.path}`,
            content: Buffer.from(file.content, 'utf8').toString('base64'),
            branch,
            ...(existing ? { sha: existing } : {}),
          });
        }
      }

      // Open a draft PR, or update the one already open for this branch (idempotent).
      const existingPrs = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner,
        repo: name,
        head: `${owner}:${branch}`,
        state: 'open',
      });
      const open = (existingPrs.data ?? [])[0];
      if (open) {
        const res = await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner,
          repo: name,
          pull_number: open.number,
          title,
          body,
        });
        return {
          url: res.data?.html_url ?? open.html_url,
          number: res.data?.number ?? open.number,
        };
      }
      const res = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner,
        repo: name,
        title,
        head: branch,
        base,
        body,
        draft: true,
      });
      return { url: res.data.html_url, number: res.data.number };
    },

    async addPrSuggestions(
      pr: PrRef,
      files: { path: string; content: string }[],
      summary: string,
    ): Promise<void> {
      const sections = files
        .map((file) => `#### \`${file.path}\`\n\n\`\`\`\n${file.content}\n\`\`\``)
        .join('\n\n');
      const body = `${summary}\n\n### Proposed changes\n\n${sections}`;
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        body,
      });
    },

    async postCheckRun(
      pr: PrRef,
      conclusion: 'success' | 'neutral' | 'failure',
      title: string,
      summary: string,
    ): Promise<void> {
      await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
        owner: pr.owner,
        repo: pr.repo,
        name: CHECK_RUN_NAME,
        head_sha: pr.headSha,
        status: 'completed',
        conclusion,
        output: { title, summary },
      });
    },
  };
}
