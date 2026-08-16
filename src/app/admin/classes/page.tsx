import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { SimpleCrudSection } from "@/components/admin/SimpleCrudSection";
import { readCsvFile } from "@/lib/csv";
import { isForeignKeyError } from "@/lib/prismaErrors";

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
  try {
    await prisma.classGroup.delete({ where: { id } });
  } catch (e) {
    if (isForeignKeyError(e)) {
      redirect(
        `/admin/classes?error=${encodeURIComponent(
          "このクラスはカリキュラムまたは時間割で使用されているため削除できません。先にそちらを削除してください。"
        )}`
      );
    }
    throw e;
  }
  revalidatePath("/admin/classes");
}

async function importClassesCsv(formData: FormData) {
  "use server";
  const rows = await readCsvFile(formData.get("file"));
  const org = await getDefaultOrganization();

  let count = 0;
  for (const row of rows) {
    const name = row["名前"]?.trim();
    if (!name) continue;
    const grade = row["学年"]?.trim() || null;
    await prisma.classGroup.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: { grade },
      create: { organizationId: org.id, name, grade },
    });
    count++;
  }

  revalidatePath("/admin/classes");
  redirect(`/admin/classes?notice=${encodeURIComponent(`${count}件のクラスを取り込みました。`)}`);
}

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
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
      csvUploadAction={importClassesCsv}
      csvColumnsHint="名前,学年"
      notice={notice}
      error={error}
    />
  );
}
