import type { PrismaClient } from '@prisma/client';
import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';

type UserProfilePatch = {
  displayName?: string | null;
  bio?: string | null;
  image?: string | null;
};

const allowedFields = new Set<keyof UserProfilePatch>(['displayName', 'bio', 'image']);

const optionalText = (value: unknown, field: string, maxLength: number): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} is invalid`);
  }
  return value;
};

const profilePatch = (body: unknown): UserProfilePatch => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'Profile body must be an object');
  }
  const entries = Object.entries(body);
  const unknownField = entries.find(([key]) => !allowedFields.has(key as keyof UserProfilePatch));
  if (unknownField) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `Field ${unknownField[0]} is not editable`);
  }
  const raw = body as Record<string, unknown>;
  const image = optionalText(raw.image, 'image', 2048);
  if (image && !/^https?:\/\//i.test(image)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'image must be an HTTP(S) URL');
  }
  return {
    displayName: optionalText(raw.displayName, 'displayName', 191),
    bio: optionalText(raw.bio, 'bio', 2000),
    image,
  };
};

export const updateUserProfile = async (prisma: PrismaClient, userId: string, body: unknown) => {
  const data = profilePatch(body);
  if (Object.keys(data).every((key) => data[key as keyof UserProfilePatch] === undefined)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'At least one editable field is required');
  }
  return prisma.users.update({ where: { id: userId }, data });
};