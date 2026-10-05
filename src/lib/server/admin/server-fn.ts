import { requireAdmin } from "@/lib/server-helpers";
import { createRoleServerFn } from "@/lib/server/create-role-server-fn";

export const createAdminServerFn = createRoleServerFn(requireAdmin);
