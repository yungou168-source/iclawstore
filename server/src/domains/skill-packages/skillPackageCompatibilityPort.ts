export type SkillPackageCompatibilityOperation =
  | 'skill.list'
  | 'skill.resolve'
  | 'skill.download'
  | 'skill.publish'
  | 'package.list'
  | 'package.resolve'
  | 'package.download'
  | 'package.publish'
  | 'package.upload-ticket'
  | 'package.token-revoke';

export type SkillPackageCompareReadPort<T> = Readonly<{
  readConvex: () => Promise<T>;
  inspectCandidate: () => Promise<T | null>;
  recordDifference: (operation: SkillPackageCompatibilityOperation, candidate: T | null, convex: T) => Promise<void>;
}>;

// Compare mode intentionally returns Convex until an independently authorized cutover.
export const readWithConvexAuthority = async <T>(input: Readonly<{
  operation: SkillPackageCompatibilityOperation;
  port: SkillPackageCompareReadPort<T>;
}>) => {
  const convex = await input.port.readConvex();
  const candidate = await input.port.inspectCandidate();
  await input.port.recordDifference(input.operation, candidate, convex);
  return convex;
};