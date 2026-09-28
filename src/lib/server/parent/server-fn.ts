import { requireParent } from "@/lib/server-helpers";
import { createRoleServerFn } from "@/lib/server/create-role-server-fn";

export const createParentServerFn = createRoleServerFn(requireParent);
