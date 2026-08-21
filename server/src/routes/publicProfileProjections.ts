import type { FastifyInstance } from 'fastify';
import type {
  ProfileProjectionCatalogDisplay,
  ProfileProjectionPage,
  ProfileProjectionReadPort,
  ProfileProjectionSort,
  ProfileProjectionStarredPage,
} from '../domains/profile-projections/profileProjectionPort.js';

const pageSchema = {
  type: 'object',
  required: ['page', 'continueCursor', 'isDone'],
  additionalProperties: false,
  properties: {
    page: { type: 'array' },
    continueCursor: { type: 'string' },
    isDone: { type: 'boolean' },
  },
} as const;

const catalogDisplaySchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      required: ['mode', 'sourceRepos', 'sections'],
      additionalProperties: false,
      properties: {
        mode: { const: 'grouped' },
        sourceRepos: { type: 'array', items: { type: 'string' } },
        sections: { type: 'array' },
      },
    },
  ],
} as const;

const parseLimit = (value: unknown): number => {
  const parsed = Number(value ?? 12);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 24) {
    throw new Error('numItems must be an integer between 1 and 24');
  }
  return parsed;
};

const parseSort = (value: unknown): ProfileProjectionSort =>
  value === 'recent' ? 'recent' : 'downloads';

const parseKind = (value: unknown): 'skill' | 'plugin' | undefined => {
  if (value === undefined) return undefined;
  if (value === 'skill' || value === 'plugin') return value;
  throw new Error('kind must be skill or plugin');
};

const queryFromRequest = (handle: string, query: Record<string, unknown>) => ({
  handle,
  kind: parseKind(query.kind),
  sort: parseSort(query.sort),
  paginationOpts: {
    cursor: typeof query.cursor === 'string' && query.cursor ? query.cursor : null,
    numItems: parseLimit(query.numItems ?? query.limit),
  },
});

export async function publicProfileProjectionRoutes(
  fastify: FastifyInstance,
  options: Readonly<{ projections: ProfileProjectionReadPort }>,
): Promise<void> {
  const { projections } = options;
  fastify.get<{ Params: { handle: string }; Querystring: Record<string, unknown> }>(
    '/publishers/:handle/catalog',
    {
      schema: {
        params: { type: 'object', required: ['handle'], properties: { handle: { type: 'string', minLength: 1 } } },
        response: { 200: pageSchema },
      },
      handler: async (request): Promise<ProfileProjectionPage> =>
        projections.listCatalog(queryFromRequest(request.params.handle, request.query)),
    },
  );
  fastify.get<{ Params: { handle: string }; Querystring: Record<string, unknown> }>(
    '/publishers/:handle/starred',
    {
      schema: {
        params: { type: 'object', required: ['handle'], properties: { handle: { type: 'string', minLength: 1 } } },
        response: { 200: pageSchema },
      },
      handler: async (request): Promise<ProfileProjectionStarredPage> => {
        const { kind: _kind, ...query } = queryFromRequest(request.params.handle, request.query);
        return projections.listStarred(query);
      },
    },
  );
  fastify.get<{ Params: { handle: string }; Querystring: Record<string, unknown> }>(
    '/publishers/:handle/catalog-display',
    {
      schema: {
        params: { type: 'object', required: ['handle'], properties: { handle: { type: 'string', minLength: 1 } } },
        response: { 200: catalogDisplaySchema },
      },
      handler: async (request): Promise<ProfileProjectionCatalogDisplay | null> => {
        const { paginationOpts: _paginationOpts, ...query } = queryFromRequest(request.params.handle, request.query);
        return projections.getCatalogDisplay(query);
      },
    },
  );
}