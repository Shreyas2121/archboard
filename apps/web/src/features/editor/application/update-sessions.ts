export interface UpdateSession {
  prepareForUpdate(): Promise<void>;
  cancelUpdatePreparation(): void;
  close(): Promise<void>;
}

const activeSessions = new Set<UpdateSession>();

export function registerUpdateSession(session: UpdateSession): void {
  activeSessions.add(session);
}

export function unregisterUpdateSession(session: UpdateSession): void {
  activeSessions.delete(session);
}

export function sameActiveUpdateSessions(sessions: readonly UpdateSession[]): boolean {
  return (
    sessions.length === activeSessions.size &&
    sessions.every((session) => activeSessions.has(session))
  );
}

export async function prepareActiveEditorsForUpdate(): Promise<readonly UpdateSession[]> {
  const sessions = [...activeSessions];
  const results = await Promise.allSettled(sessions.map((session) => session.prepareForUpdate()));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected' || !sameActiveUpdateSessions(sessions)) {
    for (const session of sessions) session.cancelUpdatePreparation();
    throw failed?.status === 'rejected'
      ? failed.reason
      : new Error('Open editors changed. Review this update again.');
  }
  return sessions;
}
