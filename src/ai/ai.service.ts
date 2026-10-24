import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a helpful writing assistant integrated into Wikid, a collaborative wiki application.
Help users write, improve, and manage their content. Be concise and direct.
When asked to write or rewrite content, output only the content itself — no explanations or preamble unless asked.`;

const SUGGEST_SYSTEM_PROMPT = `You are an AI editing assistant integrated into Wikid, a collaborative wiki application.
You will receive a numbered list of document blocks (paragraphs, headings, etc.) and an editing instruction.
Some blocks may appear as "[CONTEXT: <summary>]" — these are read-only structural context. Never include them in your changes array.
Respond with ONLY a valid JSON object — no markdown, no explanation, nothing else — matching this exact schema:
{
  "changes": [
    { "index": <integer block index>, "newText": "<replacement text>" }
  ],
  "summary": "<one sentence describing what you changed>"
}
Only include blocks that need to change. Do not modify blocks unnecessarily.
Preserve the meaning and formatting intent of unchanged content.
"newText" uses inline markdown for rich formatting: **bold**, *italic*, ***bold italic***, \`code\`, ~~strikethrough~~, [text](url).
Block-level markdown (## headings, bullet lists) is NOT needed — the block type is already set by the document structure and will not change.`;

const SUMMARIZE_SYSTEM_PROMPT = `You are a text summarizer. You will receive a numbered list of document blocks.
For each block, write exactly one concise sentence (≤20 words) summarizing its content.
Respond with ONLY a valid JSON array — no markdown, no explanation:
[{ "index": <integer>, "summary": "<one sentence>" }]
Include every block index from the input.`;

const WIKI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_pages',
    description:
      'Search the wiki for pages relevant to a query. Returns a list of matching pages with their titles and IDs. Use this to discover what information is available before reading specific pages.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search term to look for in page titles and content',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_page_content',
    description: 'Retrieve the full text content of a specific wiki page by its ID.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'The ID of the page to read',
        },
      },
      required: ['pageId'],
    },
  },
];

function buildChatSystemPrompt(pageContext?: string): string {
  let prompt = `You are a knowledgeable assistant integrated into Wikid, a collaborative wiki application.
You have access to tools to search and read pages in the wiki.
When a user asks about something that might be documented in the wiki, use search_pages to find relevant pages, then get_page_content to read them.
Be concise and direct. Cite specific page titles when referencing wiki content.`;
  if (pageContext) {
    prompt += `\n\nThe user is currently viewing this page:\n\n---\n${pageContext}\n---`;
  }
  return prompt;
}

function buildUserMessage(prompt: string, context: string | undefined, mode: AiMode): string {
  switch (mode) {
    case 'improve':
      return `Improve the following text for clarity, flow, and quality. Output only the improved text:\n\n${prompt}`;
    case 'summarise':
      return `Summarise the following text concisely. Output only the summary:\n\n${prompt}`;
    case 'shorten':
      return `Make the following text more concise without losing key information. Output only the shortened text:\n\n${prompt}`;
    case 'expand':
      return `Expand the following text with more detail and depth. Output only the expanded text:\n\n${prompt}`;
    case 'tone_formal':
      return `Rewrite the following text in a formal, professional tone. Output only the rewritten text:\n\n${prompt}`;
    case 'tone_casual':
      return `Rewrite the following text in a friendly, casual tone. Output only the rewritten text:\n\n${prompt}`;
    case 'chat':
      if (context) {
        return `Here is the current page content for context:\n\n---\n${context}\n---\n\n${prompt}`;
      }
      return prompt;
    case 'write':
    default:
      return prompt;
  }
}

function extractTextFromDoc(doc: any, maxLength = 5000): string {
  if (!doc || typeof doc !== 'object') return '';
  const parts: string[] = [];
  const blockTypes = new Set([
    'paragraph', 'heading', 'toggleHeading', 'blockquote',
    'codeBlock', 'listItem', 'taskItem', 'callout',
  ]);
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text') {
      parts.push(node.text || '');
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
    if (blockTypes.has(node.type)) {
      parts.push('\n');
    }
  };
  if (Array.isArray(doc.content)) {
    doc.content.forEach(visit);
  } else {
    visit(doc);
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength);
}

export interface AiSuggestBlock {
  index: number;
  type: string;
  text: string;
}

export interface AiSuggestChange {
  index: number;
  newText: string;
}

export interface AiSuggestResult {
  changes: AiSuggestChange[];
  summary: string;
}

export interface AiSummarizeResult {
  index: number;
  summary: string;
}

export type AiMode =
  | 'write'
  | 'improve'
  | 'summarise'
  | 'shorten'
  | 'expand'
  | 'tone_formal'
  | 'tone_casual'
  | 'chat';

export type AiChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; tool: string; label: string }
  | { type: 'tool_done'; tool: string; label: string }
  | { type: 'error'; error: string };

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async *streamGenerate(
    prompt: string,
    context?: string,
    mode: AiMode = 'write',
  ): AsyncGenerator<string> {
    const userMessage = buildUserMessage(prompt, context, mode);

    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }

  async *streamChat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    workspaceId: string,
    pageContext?: string,
    currentPageOnly?: boolean,
  ): AsyncGenerator<AiChatEvent> {
    const systemPrompt = buildChatSystemPrompt(pageContext);
    const conversationMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const useTools = currentPageOnly ? undefined : WIKI_TOOLS;
    const maxIterations = currentPageOnly ? 1 : 5;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const stream = await client.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        ...(useTools ? { tools: useTools } : {}),
        messages: conversationMessages,
      });

      // Accumulated content blocks for the assistant's turn
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contentBlocks: any[] = [];
      let currentText: { type: 'text'; text: string } | null = null;
      let currentTool: { type: 'tool_use'; id: string; name: string; inputJson: string } | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUseBlocks: any[] = [];
      let stopReason: string | null = null;

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            currentText = { type: 'text', text: '' };
          } else if (event.content_block.type === 'tool_use') {
            currentTool = {
              type: 'tool_use',
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: '',
            };
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta' && currentText) {
            currentText.text += event.delta.text;
            yield { type: 'text', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta' && currentTool) {
            currentTool.inputJson += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentText) {
            contentBlocks.push(currentText);
            currentText = null;
          } else if (currentTool) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(currentTool.inputJson || '{}');
            } catch {
              /* ignore */
            }
            const toolBlock = {
              type: 'tool_use' as const,
              id: currentTool.id,
              name: currentTool.name,
              input,
            };
            contentBlocks.push(toolBlock);
            toolUseBlocks.push(toolBlock);
            currentTool = null;
          }
        } else if (event.type === 'message_delta') {
          stopReason = event.delta.stop_reason ?? null;
        }
      }

      if (stopReason === 'end_turn' || toolUseBlocks.length === 0) break;

      // Add assistant message with tool use to conversation
      conversationMessages.push({ role: 'assistant', content: contentBlocks });

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        const input = (toolBlock.input ?? {}) as Record<string, string>;

        const startLabel = await this.getToolStartLabel(toolBlock.name, input, workspaceId);
        yield { type: 'tool_start', tool: toolBlock.name, label: startLabel };

        const result = await this.executeTool(toolBlock.name, input, workspaceId);

        const doneLabel = this.getToolDoneLabel(toolBlock.name, result);
        yield { type: 'tool_done', tool: toolBlock.name, label: doneLabel };

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }

      conversationMessages.push({ role: 'user', content: toolResults });
    }
  }

  private async getToolStartLabel(
    name: string,
    input: Record<string, string>,
    workspaceId: string,
  ): Promise<string> {
    if (name === 'search_pages') {
      return `Searching: "${input.query || ''}"`;
    }
    if (name === 'get_page_content') {
      const page = await this.prisma.page.findFirst({
        where: { id: input.pageId, workspaceId },
        select: { title: true },
      });
      return `Reading: "${page?.title || 'Untitled'}"`;
    }
    return name;
  }

  private getToolDoneLabel(name: string, result: any): string {
    if (name === 'search_pages') {
      const count = Array.isArray(result?.pages) ? result.pages.length : 0;
      return `Found ${count} page${count !== 1 ? 's' : ''}`;
    }
    if (name === 'get_page_content') {
      return result?.error ? 'Not found' : 'Done';
    }
    return 'Done';
  }

  private async executeTool(
    name: string,
    input: Record<string, string>,
    workspaceId: string,
  ): Promise<unknown> {
    if (name === 'search_pages') {
      return this.searchPages(input.query || '', workspaceId);
    }
    if (name === 'get_page_content') {
      return this.getPageContent(input.pageId || '', workspaceId);
    }
    return { error: `Unknown tool: ${name}` };
  }

  private async searchPages(query: string, workspaceId: string) {
    if (!query.trim()) return { pages: [] };
    const results = await this.prisma.$queryRaw<{ id: string; title: string }[]>`
      SELECT id, title
      FROM "Page"
      WHERE "workspaceId" = ${workspaceId}::uuid
        AND "deletedAt" IS NULL
        AND (
          title ILIKE ${'%' + query + '%'}
          OR content::text ILIKE ${'%' + query + '%'}
        )
      ORDER BY "updatedAt" DESC
      LIMIT 8
    `;
    return {
      pages: results.map((p) => ({ id: p.id, title: p.title || 'Untitled' })),
    };
  }

  private async getPageContent(pageId: string, workspaceId: string) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, workspaceId, deletedAt: null },
      select: { id: true, title: true, content: true },
    });
    if (!page) return { error: 'Page not found' };
    const text = extractTextFromDoc(page.content);
    return { id: page.id, title: page.title || 'Untitled', content: text };
  }

  async generateSuggestions(
    prompt: string,
    blocks: AiSuggestBlock[],
  ): Promise<AiSuggestResult> {
    const blockList = blocks
      .map((b) => `[${b.index}] (${b.type}) ${b.text}`)
      .join('\n');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SUGGEST_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Document blocks:\n${blockList}\n\nInstruction: ${prompt}`,
        },
      ],
    });

    const raw = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { changes: [], summary: 'No changes suggested' };

    try {
      return JSON.parse(jsonMatch[0]) as AiSuggestResult;
    } catch {
      return { changes: [], summary: 'No changes suggested' };
    }
  }

  async summarizeBlocks(blocks: AiSuggestBlock[]): Promise<AiSummarizeResult[]> {
    if (!blocks.length) return [];

    const blockList = blocks
      .map((b) => `[${b.index}] (${b.type}) ${b.text}`)
      .join('\n');

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      system: SUMMARIZE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Summarize each block in one sentence:\n${blockList}`,
        },
      ],
    });

    const raw = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('');

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed)
        ? parsed.filter(
            (r): r is AiSummarizeResult =>
              typeof r?.index === 'number' && typeof r?.summary === 'string',
          )
        : [];
    } catch {
      return [];
    }
  }
}
