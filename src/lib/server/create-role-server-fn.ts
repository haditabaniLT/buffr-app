import { createMiddleware, createServerFn } from "@tanstack/react-start";

/**
 * Shared POST server-function setup: require an access token, then run the
 * role check. Each role folder exports its own factory so a parent module
 * cannot opt into the admin check.
 */
export function createRoleServerFn<TContext extends Record<string, unknown>>(
  requireAuth: (accessToken: string) => Promise<TContext>,
) {
  const middleware = createMiddleware({ type: "function" })
    .inputValidator((input: { accessToken: string }) => {
      if (!input?.accessToken) throw new Error("Please sign in again.");
      return input;
    })
    .server(async ({ next, data }) => {
      return next({ context: await requireAuth(data.accessToken) });
    });

  return () => createServerFn({ method: "POST" }).middleware([middleware]);
}
