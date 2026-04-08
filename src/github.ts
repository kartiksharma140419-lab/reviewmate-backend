import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

/**
 * Fetch the last 50 closed PRs for a specific repo
 */
export async function getClosedPRs(owner: string, repo: string, limit: number = 50) {
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'closed',
    per_page: limit,
    sort: 'updated',
    direction: 'desc'
  });
  return prs;
}

/**
 * Fetch the exact diff for a specific pull request
 */
export async function getPRDiff(owner: string, repo: string, pull_number: number) {
  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: {
      format: 'diff',
    },
  });
  return typeof data === 'string' ? data : String(data);
}

/**
 * Post an inline comment on a pull request diff
 */
export async function postInlineComment(
  owner: string, 
  repo: string, 
  pull_number: number, 
  commit_id: string, 
  path: string, 
  line: number, 
  body: string
) {
  await octokit.rest.pulls.createReviewComment({
    owner,
    repo,
    pull_number,
    commit_id,
    path,
    line,
    body,
  });
}

/**
 * Post a summary comment on the pull request based on risk score
 */
export async function postSummaryComment(
  owner: string,
  repo: string,
  issue_number: number,
  body: string
) {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number,
    body,
  });
}

/**
 * Get the latest commit SHA for a PR to use for commenting
 */
export async function getLatestCommitId(owner: string, repo: string, pull_number: number) {
  const { data: commits } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number,
  });
  return commits[commits.length - 1].sha;
}
