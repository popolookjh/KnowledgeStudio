import { describe, expect, it } from 'vitest';
import {
  andThen,
  err,
  isErr,
  isOk,
  mapErr,
  mapResult,
  ok,
  unwrap,
  unwrapOr,
  type Result,
} from '../src/index.js';

describe('ok / err constructors', () => {
  it('builds a success result', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('builds an error result', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });
});

describe('type guards', () => {
  it('narrows success results with isOk', () => {
    const result: Result<number, string> = ok(1);
    if (isOk(result)) {
      expect(result.value).toBe(1);
    } else {
      expect.unreachable('isOk must narrow an ok result');
    }
  });

  it('narrows error results with isErr', () => {
    const result: Result<number, string> = err('nope');
    if (isErr(result)) {
      expect(result.error).toBe('nope');
    } else {
      expect.unreachable('isErr must narrow an err result');
    }
  });
});

describe('unwrap', () => {
  it('returns the value on success', () => {
    expect(unwrap(ok(7))).toBe(7);
  });

  it('throws an Error describing the failure', () => {
    expect(() => unwrap(err(new RangeError('out of bounds')))).toThrowError(
      'Called unwrap on an error result: out of bounds',
    );
  });

  it('stringifies non-Error payloads', () => {
    expect(() => unwrap(err('plain'))).toThrowError('Called unwrap on an error result: plain');
  });
});

describe('unwrapOr', () => {
  it('returns the value on success', () => {
    expect(unwrapOr(ok(3), -1)).toBe(3);
  });

  it('returns the fallback on error', () => {
    expect(unwrapOr(err('x'), -1)).toBe(-1);
  });
});

describe('mapResult / mapErr / andThen', () => {
  it('maps success values', () => {
    expect(mapResult(ok(2), (v) => v * 10)).toEqual({ ok: true, value: 20 });
  });

  it('passes errors through mapResult', () => {
    const failure = err(new Error('keep me'));
    expect(mapResult(failure, () => 999)).toBe(failure);
  });

  it('maps error payloads', () => {
    expect(mapErr(err('low'), (e) => e.toUpperCase())).toEqual({ ok: false, error: 'LOW' });
  });

  it('passes successes through mapErr', () => {
    const success = ok(5);
    expect(mapErr(success, () => 0)).toBe(success);
  });

  it('chains fallible operations with andThen', () => {
    const parse = (s: string): Result<number, string> =>
      /^\d+$/.test(s) ? ok(Number(s)) : err(`not a number: ${s}`);
    expect(andThen(ok('12'), parse)).toEqual({ ok: true, value: 12 });
    expect(andThen(ok('x'), parse)).toEqual({ ok: false, error: 'not a number: x' });
  });
});
