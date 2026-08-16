import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { SimpleCrudSection } from "@/components/admin/SimpleCrudSection";
import { readCsvFile } from "@/lib/csv";
import { isForeignKeyError } from "@/lib/prismaErrors";

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
  try {
    await prisma.teacher.delete({ where: { id } });
  } catch (e) {
    if (isForeignKeyError(e)) {
      redirect(
        `/admin/teachers?error=${encodeURIComponent(
          "この教員はカリキュラム・時間割・不可時間設定のいずれかで使用されているため削除できません。先にそちらを削除してください。"
        )}`
      );
    }
    throw e;
  }
  revalidatePath("/admin/teachers");
}

async function importTeachersCsv(formData: FormData) {
  "use server";
  const rows = await readCsvFile(formData.get("file"));
  const org = await getDefaultOrganization();

  let count = 0;
  for (const row of rows) {
    const name = row["名前"]?.trim();
    if (!name) continue;
    await prisma.teacher.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name },
    });
    count++;
  }

  revalidatePath("/admin/teachers");
  redirect(`/admin/teachers?notice=${encodeURIComponent(`${count}件の教員を取り込みました。`)}`);
}

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
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
      csvUploadAction={importTeachersCsv}
      csvColumnsHint="名前"
      notice={notice}
      error={error}
    />
  );
}
