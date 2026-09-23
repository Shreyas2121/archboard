import { z } from 'zod';

import { objectEnvelopeSchema } from '../http/index.js';

export const userIdSchema = z.string().min(1);

export const userSummarySchema = z.strictObject({
  id: userIdSchema,
  name: z.string(),
  image: z.url({ protocol: /^https?$/ }).nullable(),
});

export const currentUserSchema = userSummarySchema.safeExtend({
  email: z.email(),
});

export const currentUserResponseSchema = objectEnvelopeSchema(currentUserSchema);

export type UserId = z.infer<typeof userIdSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;
