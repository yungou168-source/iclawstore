import { makeFunctionReference } from 'convex/server';
import type { ConvexHttpClient } from 'convex/browser';
import type { PublicProfile, PublicProfilePort } from './publicProfilePort.js';

const getPublicProfileBySlug = makeFunctionReference<'query', { slug: string }, PublicProfile | null>(
  'users:getPublicProfileBySlug',
);

export const createConvexPublicProfileAdapter = (
  client: Pick<ConvexHttpClient, 'query'>,
): PublicProfilePort =>
  Object.freeze({
    getBySlug: async (slug) => client.query(getPublicProfileBySlug, { slug }),
  });