export type CandidateMatchInput = {
  agentId: string;
  displayName: string;
  availability: string;
  capabilitySummary: unknown;
  isEmployedByCurrentOrganization: boolean;
};

export type CandidateMatch = {
  agentId: string;
  displayName: string;
  score: number;
  matchedCapabilities: string[];
  missingCapabilities: string[];
  availability: string;
  isEmployedByCurrentOrganization: boolean;
};

const normalizedStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, "zh-CN"));
};

export const requiredCapabilitiesFrom = (requirementsSummary: unknown): string[] => {
  if (
    !requirementsSummary ||
    typeof requirementsSummary !== "object" ||
    Array.isArray(requirementsSummary)
  )
    return [];
  return normalizedStrings((requirementsSummary as Record<string, unknown>).requiredCapabilities);
};

export const candidateCapabilitiesFrom = (capabilitySummary: unknown): string[] => {
  if (Array.isArray(capabilitySummary)) return normalizedStrings(capabilitySummary);
  if (!capabilitySummary || typeof capabilitySummary !== "object") return [];
  return normalizedStrings((capabilitySummary as Record<string, unknown>).capabilities);
};

export const matchCandidate = (
  requiredCapabilities: string[],
  candidate: CandidateMatchInput,
): CandidateMatch => {
  const candidateCapabilities = new Set(candidateCapabilitiesFrom(candidate.capabilitySummary));
  const matchedCapabilities = requiredCapabilities.filter((capability) =>
    candidateCapabilities.has(capability),
  );
  const missingCapabilities = requiredCapabilities.filter(
    (capability) => !candidateCapabilities.has(capability),
  );
  const score =
    requiredCapabilities.length === 0
      ? 0
      : Math.round((matchedCapabilities.length * 100) / requiredCapabilities.length);

  return {
    agentId: candidate.agentId,
    displayName: candidate.displayName,
    score,
    matchedCapabilities,
    missingCapabilities,
    availability: candidate.availability,
    isEmployedByCurrentOrganization: candidate.isEmployedByCurrentOrganization,
  };
};

export const rankCandidateMatches = (
  requiredCapabilities: string[],
  candidates: CandidateMatchInput[],
): CandidateMatch[] =>
  candidates
    .filter((candidate) => candidate.availability === "available")
    .map((candidate) => matchCandidate(requiredCapabilities, candidate))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.displayName.localeCompare(right.displayName, "zh-CN") ||
        left.agentId.localeCompare(right.agentId),
    );
