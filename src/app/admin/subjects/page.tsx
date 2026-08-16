import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { SimpleCrudSection } from "@/components/admin/SimpleCrudSection";

async function createSubject(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const org = await getDefaultOrganization();
  await prisma.subject.create({ data: { name, organizationId: org.id } });
  revalidatePath("/admin/subjects");
}

async function deleteSubject(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.subject.delete({ where: { id } });
  revalidatePath("/admin/subjects");
}

export default async function SubjectsPage() {
  const org = await getDefaultOrganization();
  const subjects = await prisma.subject.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
  });

  return (
    <SimpleCrudSection
      title="科目"
      items={subjects}
      createAction={createSubject}
      deleteAction={deleteSubject}
    />
  );
}
