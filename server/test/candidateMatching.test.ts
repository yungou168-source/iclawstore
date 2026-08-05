import { describe, expect, it } from 'bun:test';
import { rankCandidateMatches, requiredCapabilitiesFrom } from '../src/services/candidateMatching.js';

describe('candidateMatching', () => {
  it('returns stable, explainable capability matches', () => {
    const required = requiredCapabilitiesFrom({ requiredCapabilities: ['sql', 'typescript'] });
    const matches = rankCandidateMatches(required, [
      { agentId: 'b', displayName: 'Beta', availability: 'available', capabilitySummary: { capabilities: ['sql'] }, isEmployedByCurrentOrganization: false },
      { agentId: 'a', displayName: 'Alpha', availability: 'available', capabilitySummary: { capabilities: ['sql', 'typescript'] }, isEmployedByCurrentOrganization: true },
      { agentId: 'c', displayName: 'Offline', availability: 'unavailable', capabilitySummary: { capabilities: ['sql', 'typescript'] }, isEmployedByCurrentOrganization: false },
    ]);
    expect(matches).toEqual([
      expect.objectContaining({ agentId: 'a', score: 100, matchedCapabilities: ['sql', 'typescript'], missingCapabilities: [] }),
      expect.objectContaining({ agentId: 'b', score: 50, matchedCapabilities: ['sql'], missingCapabilities: ['typescript'] }),
    ]);
  });
});