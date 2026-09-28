import { requireAdultChild, requireChild } from "@/lib/server-helpers";
import { createRoleServerFn } from "@/lib/server/create-role-server-fn";

export const createChildServerFn = createRoleServerFn(requireChild);
export const createAdultChildServerFn = createRoleServerFn(requireAdultChild);
