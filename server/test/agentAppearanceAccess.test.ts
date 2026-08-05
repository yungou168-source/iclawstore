import { describe, expect, it } from 'bun:test';
import {
  appearanceEtag,
  assertAppearanceRevision,
  canWriteAppearance,
  parseAppearanceIfMatch,
  requireAppearanceWriteAccess,
  type AgentAppearanceScope,
  type AppearanceQueryExecutor,
} from '../src/services/agentAppearanceAccess.js';

const baseScope = {
  agentId: 'agent-1',
  ownerUserId: 'developer-1',
  ownerPublisherId: null,
  avatarAssetId: null,
  defaultMode: 'image_2d',
  controllerEmploymentId: null,
  controllerCompanyId: null,
  revision: 3,
  updatedAt: null,
} as AgentAppearanceScope;

function executor(rows: Array<Record<string, unknown>>): AppearanceQueryExecutor {
  return { query: async () => [rows as never, {}] };
}

describe('Agent appearance access', () => {
  it('allows the developer before employment control is assigned', async () => {
    const access = await requireAppearanceWriteAccess(executor([]), baseScope, 'developer-1');
    expect(access.authority).toBe('developer');
  });

  it('makes the developer read-only while a company controls appearance', async () => {
    const controlled = {
      ...baseScope,
      controllerEmploymentId: 'employment-1',
      controllerCompanyId: 'company-1',
    };
    const result = await canWriteAppearance(executor([]), controlled, 'developer-1');
    expect(result).toEqual({
      canWrite: false,
      authority: null,
      readOnlyReason: 'controlled_by_employer',
    });
  });

  it('allows company manager but rejects recruiter', async () => {
    const controlled = {
      ...baseScope,
      controllerEmploymentId: 'employment-1',
      controllerCompanyId: 'company-1',
    };
    const manager = await requireAppearanceWriteAccess(
      executor([{ companyRole: 'manager' }]),
      controlled,
      'manager-1',
    );
    expect(manager.authority).toBe('company');

    await expect(requireAppearanceWriteAccess(
      executor([{ companyRole: 'recruiter' }]),
      controlled,
      'recruiter-1',
    )).rejects.toMatchObject({ code: 'FORBIDDEN_SCOPE', httpStatus: 403 });
  });

  it('uses stable optimistic concurrency headers', () => {
    expect(parseAppearanceIfMatch('"appearance-3"')).toBe(3n);
    expect(appearanceEtag(3)).toBe('"appearance-3"');
    expect(() => assertAppearanceRevision(2n, 3)).toThrow();
    expect(() => parseAppearanceIfMatch(undefined)).toThrow();
  });
});