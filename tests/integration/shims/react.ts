// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const cache = <T extends (...args: unknown[]) => unknown>(fn: T): T => fn as T;
