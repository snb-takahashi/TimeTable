import { Prisma } from "@prisma/client";

/** True when a delete failed because another record still references it. */
export function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}
