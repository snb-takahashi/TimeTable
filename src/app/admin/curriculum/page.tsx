import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { ClassSelector } from "@/components/admin/ClassSelector";

async function createRequirement(formData: FormData) {
  "use server";
  const classGroupId = String(formData.get("classGroupId") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");
  const teacherId = String(formData.get("teacherId") ?? "");
  const periodsPerWeek = Number(formData.get("periodsPerWeek"));
  const preferredRoomId = String(formData.get("preferredRoomId") ?? "") || null;

  if (!classGroupId || !subjectId || !teacherId || !periodsPerWeek) return;

  const org = await getDefaultOrganization();
  await prisma.curriculumRequirement.upsert({
    where: { classGroupId_subjectId: { classGroupId, subjectId } },
    update: { teacherId, periodsPerWeek, preferredRoomId },
    create: {
      organizationId: org.id,
      classGroupId,
      subjectId,
      teacherId,
      periodsPerWeek,
      preferredRoomId,
    },
  });
  revalidatePath("/admin/curriculum");
  redirect(`/admin/curriculum?classId=${classGroupId}`);
}

async function deleteRequirement(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const classGroupId = String(formData.get("classGroupId") ?? "");
  if (!id) return;
  await prisma.curriculumRequirement.delete({ where: { id } });
  revalidatePath("/admin/curriculum");
  redirect(`/admin/curriculum?classId=${classGroupId}`);
}

export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string }>;
}) {
  const { classId } = await searchParams;
  const org = await getDefaultOrganization();

  const [classGroups, subjects, teachers, rooms] = await Promise.all([
    prisma.classGroup.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.subject.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.teacher.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.room.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
  ]);

  const selectedClassId = classId ?? classGroups[0]?.id;

  if (!selectedClassId) {
    return <p className="text-sm text-gray-600">まずクラスを登録してください。</p>;
  }

  const requirements = await prisma.curriculumRequirement.findMany({
    where: { organizationId: org.id, classGroupId: selectedClassId },
    include: { subject: true, teacher: true, preferredRoom: true },
    orderBy: { subject: { name: "asc" } },
  });
  const totalPeriods = requirements.reduce((sum, r) => sum + r.periodsPerWeek, 0);

  return (
    <section className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">週間カリキュラム(担当・週コマ数)</h1>
        <ClassSelector
          classGroups={classGroups}
          selectedClassId={selectedClassId}
          basePath="/admin/curriculum"
        />
      </div>
      <p className="text-sm text-gray-600 mb-4">
        自動生成ボタンはこの設定を元に、教員・教室・クラスが重複しないように時間割を組み立てます。合計コマ数:{" "}
        <span className="font-medium">{totalPeriods}</span>
      </p>

      <ul className="mb-6 divide-y divide-gray-200 border border-gray-200 rounded">
        {requirements.length === 0 && (
          <li className="px-3 py-2 text-sm text-gray-500">まだ登録がありません</li>
        )}
        {requirements.map((r) => (
          <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              {r.subject.name} — {r.teacher.name} — 週{r.periodsPerWeek}コマ
              {r.preferredRoom ? (
                <span className="text-gray-500">(希望教室: {r.preferredRoom.name})</span>
              ) : null}
            </span>
            <form action={deleteRequirement}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="classGroupId" value={selectedClassId} />
              <button type="submit" className="text-red-600 hover:underline cursor-pointer">
                削除
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={createRequirement} className="flex gap-2 items-end flex-wrap">
        <input type="hidden" name="classGroupId" value={selectedClassId} />
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1">科目</label>
          <select
            name="subjectId"
            required
            defaultValue=""
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="" disabled>
              選択
            </option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1">担当教員</label>
          <select
            name="teacherId"
            required
            defaultValue=""
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="" disabled>
              選択
            </option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1">週コマ数</label>
          <input
            name="periodsPerWeek"
            type="number"
            min={1}
            max={20}
            required
            className="border border-gray-300 rounded px-2 py-1 text-sm w-20"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1">希望教室(任意)</label>
          <select
            name="preferredRoomId"
            defaultValue=""
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">指定なし</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="bg-black text-white rounded px-3 py-1.5 text-sm cursor-pointer"
        >
          追加/更新
        </button>
      </form>
    </section>
  );
}
