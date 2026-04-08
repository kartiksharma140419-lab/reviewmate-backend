import express, { Request, Response } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { getPRDiff, getLatestCommitId, postInlineComment, postSummaryComment } from './github';
import { getTopContexts } from './rag';
import { reviewDiff, ReviewFeedback } from './reviewer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

// We need raw data to verify the signature properly
app.use('/webhook/github', express.raw({ type: 'application/json' }));

/**
 * Verify GitHub webhook signature using X-Hub-Signature-256
 */
function verifySignature(req: Request, res: Response, buf: Buffer): boolean {
  const signatureHeader = req.headers['x-hub-signature-256'] as string;
  if (!signatureHeader) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(buf);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSignature));
  } catch (e) {
    return false;
  }
}

app.post('/webhook/github', async (req: Request, res: Response) => {
  // 1. Verify Signature
  if (!verifySignature(req, res, req.body)) {
    console.error("Webhook signature verification failed.");
    return res.status(401).send('Unauthorized: Invalid signature');
  }

  const event = req.headers['x-github-event'];
  let payload: any;
  try {
    payload = JSON.parse(req.body.toString());
  } catch (e) {
    return res.status(400).send('Bad Request: Invalid JSON');
  }

  // 2. Filter for Pull Request events (opened, synchronize)
  if (event === 'pull_request') {
    const action = payload.action;
    if (action === 'opened' || action === 'synchronize') {
      console.log(`Received PR event: ${action} for PR #${payload.pull_request.number}`);
      
      // Respond early so GitHub doesn't timeout the webhook delivery
      res.status(202).send('Accepted');

      // Process async
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const prNumber = payload.pull_request.number;

      try {
        await processPullRequest(owner, repo, prNumber);
      } catch (err: any) {
        console.error("Error processing PR review:", err);
      }
      return;
    }
  }

  res.status(200).send('OK: Event ignored');
});

/**
 * Workflow to handle PR reviewing
 */
async function processPullRequest(owner: string, repo: string, prNumber: number) {
  console.log(`Starting review process for ${owner}/${repo} PR #${prNumber}`);

  // Fetch the diff
  const diff = await getPRDiff(owner, repo, prNumber);
  if (!diff) {
    console.log("No diff found. Exiting.");
    return;
  }

  // Get Top Contexts from historical RAG DB
  const topContexts = await getTopContexts(diff);
  console.log(`Found ${topContexts.length} relevant historical contexts.`);

  // Get Claude Review
  const feedbacks: ReviewFeedback[] = await reviewDiff(diff, topContexts);
  console.log(`Claude generated ${feedbacks.length} review feedback items.`);

  if (feedbacks.length === 0) {
    console.log("No feedbacks to post.");
    return;
  }

  // Calculate Risk Score & post comments
  let blockingCount = 0;
  let warningCount = 0;
  const commitId = await getLatestCommitId(owner, repo, prNumber);

  for (const f of feedbacks) {
    if (f.severity === 'blocking') blockingCount++;
    if (f.severity === 'warning') warningCount++;

    const commentBody = `**[${f.severity.toUpperCase()}] Architecture Drift Warning**\n\n${f.comment}\n\n**Suggestion:**\n${f.suggestion}`;
    
    try {
      await postInlineComment(owner, repo, prNumber, commitId, f.file, f.line, commentBody);
    } catch (commentErr: any) {
      console.warn(`Could not post inline comment on ${f.file}:${f.line}.`, commentErr.message);
    }
  }

  const riskScore = blockingCount * 10 + warningCount * 5;
  const summaryBody = `# ReviewMate Architectural Audit\n\nReview complete using historical RAG context.\n\n**Total Risk Score: ${riskScore}**\n- Blocking Flags: ${blockingCount}\n- Warning Flags: ${warningCount}\n\nPlease review the inline comments on the changed files carefully. Address blocking flags before merging.`;

  await postSummaryComment(owner, repo, prNumber, summaryBody);
  console.log(`Review process complete for PR #${prNumber}. Score: ${riskScore}`);
}

app.listen(PORT, () => {
  console.log(`ReviewMate Server is running on port ${PORT}`);
});
