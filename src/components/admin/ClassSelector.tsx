"use client";

import { useRouter } from "next/navigation";

export function ClassSelector({
  classGroups,
  selectedClassId,
  basePath = "/admin/timetable",
}: {
  classGroups: { id: string; name: string }[];
  selectedClassId: string;
  basePath?: string;
}) {
  const router = useRouter();

  return (
    <select
      defaultValue={selectedClassId}
      onChange={(e) => router.push(`${basePath}?classId=${e.target.value}`)}
      className="border border-gray-300 rounded px-2 py-1 text-sm"
    >
      {classGroups.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
