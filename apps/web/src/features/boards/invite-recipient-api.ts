import {
  inviteAcceptanceResponseSchema,
  invitePreviewResponseSchema,
  inviteTokenRequestSchema,
} from '@archboard/contracts';
import { apiRequest } from '@/platform/api';

export async function previewInvite(token: string, signal: AbortSignal) {
  const response = await apiRequest('/invites/preview', invitePreviewResponseSchema, {
    method: 'POST',
    body: inviteTokenRequestSchema.parse({ token }),
    signal,
  });
  return response.data;
}

export async function acceptInvite(token: string, signal: AbortSignal) {
  const response = await apiRequest('/invites/accept', inviteAcceptanceResponseSchema, {
    method: 'POST',
    body: inviteTokenRequestSchema.parse({ token }),
    signal,
  });
  return response.data;
}
