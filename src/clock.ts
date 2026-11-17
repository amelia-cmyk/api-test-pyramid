/**
 * The current time is injected instead of calling `new Date()` directly.
 * Production uses the system clock; tests use a fake clock they can move forward
 * (for example "15 days later") to test overdue loans without waiting.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
