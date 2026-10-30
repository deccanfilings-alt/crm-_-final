import type { McpTool } from '../registry';
import { McpUserError } from '../format';

export const kbTools: McpTool[] = [
  {
    name: 'search_knowledge_base',
    title: 'Search knowledge base',
    description: 'Perform full-text RAG search across indexed knowledge base documents and articles.',
    scope: 'kb:read',
    minRole: 'viewer',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms or natural language question.',
        },
        kb_id: {
          type: 'string',
          description: 'Optional UUID of a specific knowledge base to restrict search.',
        },
        limit: {
          type: 'number',
          description: 'Max number of relevant chunks to retrieve (default 4, max 10).',
          default: 4,
        },
      },
      required: ['query'],
    },
    async handler(ctx, args) {
      const query = String(args.query || '').trim();
      const kbId = args.kb_id ? String(args.kb_id).trim() : null;
      const limit = Math.min(Math.max(Number(args.limit) || 4, 1), 10);

      if (!query) {
        throw new McpUserError('query is required');
      }

      const cleanWords = query
        .replace(/[^\w\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);

      const searchExpression = cleanWords.join(' or ');

      let kbQuery = ctx.db
        .from('knowledge_base_embeddings')
        .select('id, content, doc_id, knowledge_base_documents!inner(kb_id, filename, knowledge_bases!inner(account_id))')
        .eq('knowledge_base_documents.knowledge_bases.account_id', ctx.accountId);

      if (kbId) {
        kbQuery = kbQuery.eq('knowledge_base_documents.kb_id', kbId);
      }

      if (searchExpression) {
        kbQuery = kbQuery.textSearch('content', searchExpression, { type: 'websearch', config: 'english' });
      }

      const { data: chunks, error } = await kbQuery.limit(limit);

      if (error) {
        return { results: [], count: 0 };
      }

      const results = (chunks || []).map((c: any) => ({
        id: c.id,
        content: c.content,
        doc_id: c.doc_id,
        kb_id: c.knowledge_base_documents?.kb_id || null,
        filename: c.knowledge_base_documents?.filename || null,
      }));

      return { results, count: results.length };
    },
  },
];
