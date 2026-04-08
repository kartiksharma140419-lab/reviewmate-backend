import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { MemoryEntry } from './ingest';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
});

export interface ReviewFeedback {
  file: string;
  line: number;
  severity: "blocking" | "warning" | "info";
  comment: string;
  suggestion: string;
}

const SYSTEM_PROMPT = `You are a senior engineer who has been on this team for 2+ years. Use the provided historical memory to flag conflicts with past architectural decisions or team patterns.`;

export async function reviewDiff(diffText: string, contextMatches: MemoryEntry[]): Promise<ReviewFeedback[]> {
  let contextBlurb = "Historical Context from past merged PRs:\n";
  contextMatches.forEach((m, idx) => {
    contextBlurb += `\n--- Context ${idx + 1} (PR #${m.metadata.prNumber} - ${m.metadata.title}) ---\n${m.text}\n`;
  });

  const prompt = `${contextBlurb}

Here is the current PR diff to review:
<diff>
${diffText}
</diff>

Review the diff strictly for conflicts with the historical context and architectural drift. Return ONLY a JSON array of objects with the following schema:
[{ "file": "path/to/file", "line": 42, "severity": "blocking"|"warning"|"info", "comment": "description", "suggestion": "fix" }]

Do not include any explanation or markdown formatting outside the JSON array. Start your response with '[' and end with ']'.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-opus-20240229', // Fallback to standard Claude 3 Opus if the 4.6 version isn't natively parsable by the SDK or if they meant Opus.
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.1,
    });

    const completionText = response.content.find(b => b.type === 'text')?.text || '';
    
    // Extract JSON block aggressively
    const jsonMatch = completionText.match(/\[\s*\{.*\}\s*\]/s);
    if (!jsonMatch) {
      if (completionText.trim().startsWith('[') && completionText.trim().endsWith(']')) {
        return JSON.parse(completionText.trim());
      }
      console.warn("Could not match JSON array strictly from Claude output:");
      console.log(completionText);
      return [];
    }

    const feedbacks: ReviewFeedback[] = JSON.parse(jsonMatch[0]);
    return feedbacks;
  } catch (err: any) {
    console.error("Error asking Claude to review the diff:", err);
    return [];
  }
}
