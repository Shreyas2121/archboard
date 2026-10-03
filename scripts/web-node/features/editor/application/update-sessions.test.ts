import { expect, it, vi } from 'vitest';
import {
  prepareActiveEditorsForUpdate,
  registerUpdateSession,
  unregisterUpdateSession,
} from '@/features/editor/application/update-sessions';

it('refuses a worker handoff if an editor opens while another editor is saving', async () => {
  let finish!: () => void;
  const first = {
    prepareForUpdate: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    cancelUpdatePreparation: vi.fn(),
    close: vi.fn(),
  };
  const second = { prepareForUpdate: vi.fn(), cancelUpdatePreparation: vi.fn(), close: vi.fn() };
  registerUpdateSession(first);
  try {
    const preparing = prepareActiveEditorsForUpdate();
    registerUpdateSession(second);
    finish();
    await expect(preparing).rejects.toThrow('Open editors changed');
    expect(first.cancelUpdatePreparation).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  } finally {
    unregisterUpdateSession(first);
    unregisterUpdateSession(second);
  }
});
