import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { SimpleCrudSection } from "@/components/admin/SimpleCrudSection";

async function createTeacher(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const org = await getDefaultOrganization();
  await prisma.teacher.create({ data: { name, organizationId: org.id } });
  revalidatePath("/admin/teachers");
}

async function deleteTeacher(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.teacher.delete({ where: { id } });
  revalidatePath("/admin/teachers");
}

export default async function TeachersPage() {
  const org = await getDefaultOrganization();
  const teachers = await prisma.teacher.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
  });

  return (
    <SimpleCrudSection
      title="教員"
      items={teachers}
      createAction={createTeacher}
      deleteAction={deleteTeacher}
    />
  );
}
