import { jest } from '@jest/globals';
import { logAuthDiagnostic } from './auth-diagnostics.js';

describe('auth continuation diagnostics', () => {
  it('retains only a fixed event and severity, ignoring library message/argument fields', () => {
    const output = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      // Simulate the logger calling with its normal extra message/context arguments.
      const logger: (level: string, message: string, context: unknown) => void = logAuthDiagnostic;
      logger('error', 'Synthetic provider error', {
        callbackURL: 'synthetic-private-continuation',
        token: 'synthetic-secret',
      });
      expect(output).toHaveBeenCalledWith(
        JSON.stringify({ event: 'auth.diagnostic', level: 'error' }),
      );
      expect(output.mock.calls.flat().join(' ')).not.toContain('synthetic-private-continuation');
      expect(output.mock.calls.flat().join(' ')).not.toContain('synthetic-secret');
    } finally {
      output.mockRestore();
    }
  });
});
