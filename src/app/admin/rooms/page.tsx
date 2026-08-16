import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { SimpleCrudSection } from "@/components/admin/SimpleCrudSection";
import { readCsvFile } from "@/lib/csv";
import { isForeignKeyError } from "@/lib/prismaErrors";

async function createRoom(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const capacityRaw = String(formData.get("extra") ?? "").trim();
  const capacity = capacityRaw ? Number(capacityRaw) : null;
  const org = await getDefaultOrganization();
  await prisma.room.create({
    data: { name, capacity, organizationId: org.id },
  });
  revalidatePath("/admin/rooms");
}

async function deleteRoom(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await prisma.room.delete({ where: { id } });
  } catch (e) {
    if (isForeignKeyError(e)) {
      redirect(
        `/admin/rooms?error=${encodeURIComponent(
          "この教室はカリキュラムの希望教室または時間割で使用されているため削除できません。先にそちらを削除してください。"
        )}`
      );
    }
    throw e;
  }
  revalidatePath("/admin/rooms");
}

async function importRoomsCsv(formData: FormData) {
  "use server";
  const rows = await readCsvFile(formData.get("file"));
  const org = await getDefaultOrganization();

  let count = 0;
  for (const row of rows) {
    const name = row["名前"]?.trim();
    if (!name) continue;
    const capacityRaw = row["定員"]?.trim();
    const capacity = capacityRaw ? Number(capacityRaw) : null;
    await prisma.room.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: { capacity },
      create: { organizationId: org.id, name, capacity },
    });
    count++;
  }

  revalidatePath("/admin/rooms");
  redirect(`/admin/rooms?notice=${encodeURIComponent(`${count}件の教室を取り込みました。`)}`);
}

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const org = await getDefaultOrganization();
  const rooms = await prisma.room.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
  });

  return (
    <SimpleCrudSection
      title="教室"
      items={rooms.map((r) => ({
        id: r.id,
        name: r.name,
        extra: r.capacity ? `定員 ${r.capacity}` : null,
      }))}
      extraFieldLabel="定員(任意)"
      createAction={createRoom}
      deleteAction={deleteRoom}
      csvUploadAction={importRoomsCsv}
      csvColumnsHint="名前,定員"
      notice={notice}
      error={error}
    />
  );
}
