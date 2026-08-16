import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { readCsvFile } from "@/lib/csv";
import { isForeignKeyError } from "@/lib/prismaErrors";
import { CsvUploadForm } from "@/components/admin/CsvUploadForm";

async function createTeacher(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const isPartTime = formData.get("isPartTime") === "on";
  const org = await getDefaultOrganization();
  await prisma.teacher.create({ data: { name, isPartTime, organizationId: org.id } });
  revalidatePath("/admin/teachers");
}

async function toggleTeacherPartTime(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const current = formData.get("current") === "true";
  if (!id) return;
  await prisma.teacher.update({ where: { id }, data: { isPartTime: !current } });
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
    const isPartTime = Boolean(row["非常勤"]?.trim());
    await prisma.teacher.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: { isPartTime },
      create: { organizationId: org.id, name, isPartTime },
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
    <section className="max-w-xl">
      <h1 className="text-xl font-semibold mb-4">教員</h1>

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
      <p className="text-sm text-gray-600 mb-4">
        非常勤の教員は自動生成時、その日のコマが連続するように、また出勤日数ができるだけ少なくなるように配置されます。
      </p>

      <CsvUploadForm action={importTeachersCsv} columnsHint="名前,非常勤(非常勤なら○などを入力)" />

      <ul className="mb-6 divide-y divide-gray-200 border border-gray-200 rounded">
        {teachers.length === 0 && (
          <li className="px-3 py-2 text-sm text-gray-500">まだ登録がありません</li>
        )}
        {teachers.map((t) => (
          <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              {t.name}
              {t.isPartTime && <span className="ml-2 text-xs text-blue-700">(非常勤)</span>}
            </span>
            <span className="flex items-center gap-3">
              <form action={toggleTeacherPartTime}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="current" value={String(t.isPartTime)} />
                <button type="submit" className="text-blue-600 hover:underline cursor-pointer">
                  {t.isPartTime ? "非常勤を解除" : "非常勤にする"}
                </button>
              </form>
              <form action={deleteTeacher}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="text-red-600 hover:underline cursor-pointer">
                  削除
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>

      <form action={createTeacher} className="flex gap-3 items-end flex-wrap">
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1" htmlFor="name">
            名前
          </label>
          <input
            id="name"
            name="name"
            required
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm pb-1.5">
          <input type="checkbox" name="isPartTime" />
          非常勤
        </label>
        <button
          type="submit"
          className="bg-black text-white rounded px-3 py-1.5 text-sm cursor-pointer"
        >
          追加
        </button>
      </form>
    </section>
  );
}
