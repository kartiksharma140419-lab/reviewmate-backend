import { getClosedPRs, getPRDiff } from './github';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.ZLM_API_KEY,
  baseURL: process.env.ZLM_BASE_URL || undefined,
});

export interface MemoryEntry {
  id: string; // e.g. "PR-123"
  text: string; // The diff chunk or full diff
  embedding: number[];
  metadata: {
    prNumber: number;
    title: string;
    url: string;
  };
}

export async function ingestPRs(owner: string, repo: string) {
  console.log(`Fetching last 50 closed PRs from ${owner}/${repo}...`);
  const prs = await getClosedPRs(owner, repo, 50);

  const memory: MemoryEntry[] = [];

  for (const pr of prs) {
    if (!pr.merged_at) {
      // Only process actually merged PRs for historical context, or skip if instructed?
      // "last 50 closed PRs" - I'll process all closed, though merged is safer. 
      // Let's process all closed to match prompt.
    }

    try {
      console.log(`Processing PR #${pr.number}: ${pr.title}`);
      const diff = await getPRDiff(owner, repo, pr.number);
      
      if (!diff || diff.length === 0) continue;

      // To keep chunks reasonable for embedding models (limit typically 8191 tokens),
      // we might want to split large diffs. For simplicity, we embed the diff directly 
      // unless it's too large, then we chunk it roughly by lines.
      const maxChars = 20000; // rough token approx
      let chunks = [diff];
      if (diff.length > maxChars) {
        chunks = diff.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [diff];
      }

      for (let i = 0; i < chunks.length; i++) {
        const textChunk = chunks[i];
        
        console.log(`  Generating embedding for chunk ${i+1}/${chunks.length}...`);
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: textChunk,
        });

        const embedding = response.data[0].embedding;

        memory.push({
          id: `PR-${pr.number}-${i}`,
          text: textChunk,
          embedding,
          metadata: {
            prNumber: pr.number,
            title: pr.title,
            url: pr.html_url
          }
        });
      }
    } catch (e: any) {
      console.error(`Failed to process PR #${pr.number}: ${e.message}`);
    }
  }

  const memoryPath = path.join(process.cwd(), 'memory.json');
  fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
  console.log(`Successfully saved ${memory.length} vectors to memory.json`);
}

// To run via CLI: tsx src/ingest.ts <owner> <repo>
if (require.main === module) {
  const [,, owner, repo] = process.argv;
  if (!owner || !repo) {
    console.error('Usage: tsx src/ingest.ts <owner> <repo>');
    process.exit(1);
  }
  ingestPRs(owner, repo).catch(console.error);
}
