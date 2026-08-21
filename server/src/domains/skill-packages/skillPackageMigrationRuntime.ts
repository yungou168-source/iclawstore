const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

export type SkillPackageMigrationAuthorization = Readonly<{
  environment: 'candidate';
  approvalRef: string;
}>;

export const requireSkillPackageMigrationAuthorization = (
  environment: NodeJS.ProcessEnv = process.env,
): SkillPackageMigrationAuthorization => {
  if (environment.SKILL_PACKAGE_MIGRATION_EXECUTION !== '1') {
    throw new Error('SKILL_PACKAGE_MIGRATION_EXECUTION=1 is required');
  }
  if (required(environment.SKILL_PACKAGE_MIGRATION_ENV, 'SKILL_PACKAGE_MIGRATION_ENV') !== 'candidate') {
    throw new Error('SKILL_PACKAGE_MIGRATION_ENV must be candidate');
  }
  if (environment.SKILL_PACKAGE_MIGRATION_PRODUCTION_TARGET === '1') {
    throw new Error('Skill/Package migration does not support production targets');
  }
  return Object.freeze({
    environment: 'candidate',
    approvalRef: required(
      environment.SKILL_PACKAGE_MIGRATION_APPROVAL_REF,
      'SKILL_PACKAGE_MIGRATION_APPROVAL_REF',
    ),
  });
};

export const skillPackageMigrationBatchSize = (value: string | undefined): number => {
  const size = Number(value ?? 100);
  if (!Number.isSafeInteger(size) || size < 1 || size > 250) {
    throw new Error('SKILL_PACKAGE_MIGRATION_BATCH_SIZE must be an integer between 1 and 250');
  }
  return size;
};