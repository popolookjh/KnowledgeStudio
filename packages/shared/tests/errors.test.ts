import { describe, expect, it } from 'vitest';
import { StudioError } from '../src/index.js';

class SampleError extends StudioError {
  constructor(message: string, cause?: unknown) {
    super('SAMPLE_FAILURE', message, { cause, details: { attempt: 1 } });
  }
}

describe('StudioError', () => {
  it('carries a stable code and a human message', () => {
    const error = new StudioError('SOME_CODE', 'something went wrong');
    expect(error.code).toBe('SOME_CODE');
    expect(error.message).toBe('something went wrong');
    expect(error instanceof Error).toBe(true);
  });

  it('keeps the subclass name for stack traces', () => {
    const error = new SampleError('details missing');
    expect(error.name).toBe('SampleError');
    expect(error instanceof SampleError).toBe(true);
    expect(error instanceof StudioError).toBe(true);
  });

  it('exposes structured details for logging', () => {
    const error = new SampleError('details missing');
    expect(error.details).toEqual({ attempt: 1 });
  });

  it('leaves details undefined when omitted', () => {
    const error = new StudioError('BARE', 'no details');
    expect(error.details).toBeUndefined();
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('root cause');
    const error = new SampleError('wrapped', cause);
    expect(error.cause).toBe(cause);
  });
});
