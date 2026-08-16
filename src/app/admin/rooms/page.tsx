import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { SimpleCrudSection } from "@/components/admin/SimpleCrudSection";

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
  await prisma.room.delete({ where: { id } });
  revalidatePath("/admin/rooms");
}

export default async function RoomsPage() {
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
    />
  );
}
