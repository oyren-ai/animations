/** Owns one Remotion delay handle across font load, effect replay, and unmount. */
export function createRenderGate<Handle>(
  acquire: () => Handle,
  resume: (handle: Handle) => void,
  cancel: (error: Error) => void,
) {
  let pending: Handle | undefined;
  return {
    start(): void {
      if (pending === undefined) pending = acquire();
    },
    release(): void {
      if (pending === undefined) return;
      const handle = pending;
      pending = undefined;
      resume(handle);
    },
    fail(reason: unknown): void {
      if (pending === undefined) return;
      pending = undefined;
      cancel(reason instanceof Error ? reason : new Error(String(reason)));
    },
  };
}
