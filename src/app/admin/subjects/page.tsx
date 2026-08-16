import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { SimpleCrudSection } from "@/components/admin/SimpleCrudSection";
import { readCsvFile } from "@/lib/csv";
import { isForeignKeyError } from "@/lib/prismaErrors";

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
  try {
    await prisma.subject.delete({ where: { id } });
  } catch (e) {
    if (isForeignKeyError(e)) {
      redirect(
        `/admin/subjects?error=${encodeURIComponent(
          "この科目はカリキュラムまたは時間割で使用されているため削除できません。先にそちらを削除してください。"
        )}`
      );
    }
    throw e;
  }
  revalidatePath("/admin/subjects");
}

async function importSubjectsCsv(formData: FormData) {
  "use server";
  const rows = await readCsvFile(formData.get("file"));
  const org = await getDefaultOrganization();

  let count = 0;
  for (const row of rows) {
    const name = row["名前"]?.trim();
    if (!name) continue;
    const code = row["コード"]?.trim() || null;
    await prisma.subject.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: { code },
      create: { organizationId: org.id, name, code },
    });
    count++;
  }

  revalidatePath("/admin/subjects");
  redirect(`/admin/subjects?notice=${encodeURIComponent(`${count}件の科目を取り込みました。`)}`);
}

export default async function SubjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
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
      csvUploadAction={importSubjectsCsv}
      csvColumnsHint="名前,コード"
      notice={notice}
      error={error}
    />
  );
}
