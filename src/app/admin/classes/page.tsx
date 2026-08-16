import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { SimpleCrudSection } from "@/components/admin/SimpleCrudSection";

async function createClassGroup(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const grade = String(formData.get("extra") ?? "").trim() || null;
  const org = await getDefaultOrganization();
  await prisma.classGroup.create({ data: { name, grade, organizationId: org.id } });
  revalidatePath("/admin/classes");
}

async function deleteClassGroup(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.classGroup.delete({ where: { id } });
  revalidatePath("/admin/classes");
}

export default async function ClassesPage() {
  const org = await getDefaultOrganization();
  const classGroups = await prisma.classGroup.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
  });

  return (
    <SimpleCrudSection
      title="クラス"
      items={classGroups.map((c) => ({
        id: c.id,
        name: c.name,
        extra: c.grade,
      }))}
      extraFieldLabel="学年(任意)"
      createAction={createClassGroup}
      deleteAction={deleteClassGroup}
    />
  );
}
