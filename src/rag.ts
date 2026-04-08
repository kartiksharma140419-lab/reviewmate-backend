import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { MemoryEntry } from './ingest';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.ZLM_API_KEY,
  baseURL: process.env.ZLM_BASE_URL || undefined,
});

/**
 * Rapid in-memory cosine similarity using Math.hypot for magnitude.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  
  // Note: For unit vectors (like normalized embeddings), Math.hypot values are ~1, 
  // but let's be strict and apply it properly to ensure accuracy.
  const magA = Math.hypot(...vecA);
  const magB = Math.hypot(...vecB);
  
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

/**
 * Generate an embedding for the active PR diff.
 */
export async function embedText(text: string): Promise<number[]> {
  const maxChars = 20000;
  const chunk = text.length > maxChars ? text.substring(0, maxChars) : text;
  
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunk,
  });
  
  return response.data[0].embedding;
}

/**
 * Compare the new diff against memory.json and retrieve top 5 matching context items.
 */
export async function getTopContexts(diffText: string): Promise<MemoryEntry[]> {
  const targetEmbedding = await embedText(diffText);
  const memoryPath = path.join(process.cwd(), 'memory.json');
  
  if (!fs.existsSync(memoryPath)) {
    console.warn("memory.json not found. Returning empty context.");
    return [];
  }
  
  const memory: MemoryEntry[] = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
  
  const scoredContexts = memory.map(entry => {
    const score = cosineSimilarity(targetEmbedding, entry.embedding);
    return { entry, score };
  });
  
  // Filter score > 0.75 and get top 5
  const topMatches = scoredContexts
    .filter(x => x.score > 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.entry);
    
  return topMatches;
}
