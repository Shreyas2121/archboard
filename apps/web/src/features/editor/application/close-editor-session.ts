import type { EditorSession } from './editor-session';

/** Route cleanup cannot await React teardown; handle its rejected promise here. */
export async function closeEditorSession(session: EditorSession | null): Promise<void> {
  try {
    await session?.close();
  } catch (error) {
    console.error('Editor session cleanup failed.', error);
  }
}
