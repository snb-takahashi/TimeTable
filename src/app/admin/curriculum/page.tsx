import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { readCsvFile } from "@/lib/csv";
import { ClassSelector } from "@/components/admin/ClassSelector";
import { CsvUploadForm } from "@/components/admin/CsvUploadForm";

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
    where: { classGroupId_subjectId_teacherId: { classGroupId, subjectId, teacherId } },
    update: { periodsPerWeek, preferredRoomId },
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

  const requirement = await prisma.curriculumRequirement.findUnique({ where: { id } });
  if (!requirement) return;

  // A requirement has no direct FK to TimetableEntry, so removing it doesn't
  // cascade on its own — clear out the matching assignments explicitly,
  // otherwise they'd be orphaned leftovers with no requirement backing them.
  // Scoped to this requirement's teacher too: the same class/subject can
  // have other requirements (team-taught by a different teacher) whose
  // entries must be left alone.
  const [{ count: deletedEntries }] = await prisma.$transaction([
    prisma.timetableEntry.deleteMany({
      where: {
        classGroupId: requirement.classGroupId,
        subjectId: requirement.subjectId,
        teacherId: requirement.teacherId,
      },
    }),
    prisma.curriculumRequirement.delete({ where: { id } }),
  ]);

  revalidatePath("/admin/curriculum");
  revalidatePath("/admin/timetable");
  revalidatePath("/admin/schedule/by-class");
  revalidatePath("/admin/schedule/by-teacher");
  revalidatePath("/admin/schedule/by-room");

  const notice =
    deletedEntries > 0
      ? `カリキュラムを削除しました(連動して時間割の割当${deletedEntries}件も削除しました)。`
      : undefined;
  redirect(
    `/admin/curriculum?classId=${classGroupId}` +
      (notice ? `&notice=${encodeURIComponent(notice)}` : "")
  );
}

async function importCurriculumCsv(formData: FormData) {
  "use server";
  const rows = await readCsvFile(formData.get("file"));
  const org = await getDefaultOrganization();

  const [classGroups, subjects, teachers, rooms] = await Promise.all([
    prisma.classGroup.findMany({ where: { organizationId: org.id } }),
    prisma.subject.findMany({ where: { organizationId: org.id } }),
    prisma.teacher.findMany({ where: { organizationId: org.id } }),
    prisma.room.findMany({ where: { organizationId: org.id } }),
  ]);
  const classByName = new Map(classGroups.map((c) => [c.name, c]));
  const subjectByName = new Map(subjects.map((s) => [s.name, s]));
  const teacherByName = new Map(teachers.map((t) => [t.name, t]));
  const roomByName = new Map(rooms.map((r) => [r.name, r]));

  let count = 0;
  const errors: string[] = [];
  let lastClassGroupId = classGroups[0]?.id ?? "";

  for (const [i, row] of rows.entries()) {
    const className = row["クラス"]?.trim();
    const subjectName = row["科目"]?.trim();
    const teacherName = row["担当教員"]?.trim();
    const periodsPerWeek = Number(row["週コマ数"]);
    const roomName = row["希望教室"]?.trim();

    const classGroup = className ? classByName.get(className) : undefined;
    const subject = subjectName ? subjectByName.get(subjectName) : undefined;
    const teacher = teacherName ? teacherByName.get(teacherName) : undefined;
    const room = roomName ? roomByName.get(roomName) : undefined;

    if (!classGroup) {
      errors.push(`${i + 2}行目: クラス「${className}」が見つかりません`);
      continue;
    }
    if (!subject) {
      errors.push(`${i + 2}行目: 科目「${subjectName}」が見つかりません`);
      continue;
    }
    if (!teacher) {
      errors.push(`${i + 2}行目: 教員「${teacherName}」が見つかりません`);
      continue;
    }
    if (!periodsPerWeek) {
      errors.push(`${i + 2}行目: 週コマ数が不正です`);
      continue;
    }
    if (roomName && !room) {
      errors.push(`${i + 2}行目: 教室「${roomName}」が見つかりません`);
      continue;
    }

    await prisma.curriculumRequirement.upsert({
      where: {
        classGroupId_subjectId_teacherId: {
          classGroupId: classGroup.id,
          subjectId: subject.id,
          teacherId: teacher.id,
        },
      },
      update: { periodsPerWeek, preferredRoomId: room?.id ?? null },
      create: {
        organizationId: org.id,
        classGroupId: classGroup.id,
        subjectId: subject.id,
        teacherId: teacher.id,
        periodsPerWeek,
        preferredRoomId: room?.id ?? null,
      },
    });
    count++;
    lastClassGroupId = classGroup.id;
  }

  revalidatePath("/admin/curriculum");
  const message =
    `${count}件のカリキュラムを取り込みました。` +
    (errors.length > 0 ? ` (エラー${errors.length}件: ${errors.slice(0, 5).join(" / ")})` : "");
  redirect(
    `/admin/curriculum?classId=${lastClassGroupId}&${errors.length > 0 ? "error" : "notice"}=${encodeURIComponent(message)}`
  );
}

export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; notice?: string; error?: string }>;
}) {
  const { classId, notice, error } = await searchParams;
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

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      )}

      <CsvUploadForm
        action={importCurriculumCsv}
        columnsHint="クラス,科目,週コマ数,担当教員,希望教室"
      />

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
