import { prisma } from "@/lib/db";

// Phase 1 has no auth/multi-tenant UI yet, but every table already carries
// organizationId so Phase 3 (multi-org) only needs to stop hardcoding this.
export async function getDefaultOrganization() {
  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!org) {
    throw new Error(
      "No organization found. Run `npm run db:seed` to create demo data."
    );
  }
  return org;
}
