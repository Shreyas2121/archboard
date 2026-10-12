import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from './auth-client';
import { loadWebConfig } from '@/platform/config';

export function LocalDevelopmentSignIn({ onSignedIn }: { onSignedIn: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const local = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (
    !import.meta.env.DEV ||
    !local(window.location.hostname) ||
    !local(new URL(loadWebConfig(import.meta.env).apiOrigin).hostname)
  )
    return null;
  async function signIn() {
    setBusy(true);
    setFailed(false);
    try {
      const result = await authClient.$fetch('/sign-in/local', { method: 'POST' });
      if (result.error) {
        setFailed(true);
        return;
      }
      await onSignedIn();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={busy}
        onClick={() => void signIn()}
      >
        {busy ? 'Signing in locally…' : 'Continue as local test account'}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Local sign-in failed. Check that the API is running in development mode.
        </p>
      )}
    </div>
  );
}
