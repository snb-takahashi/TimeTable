"use client";

import { useRouter } from "next/navigation";

export function EntitySelector({
  items,
  selectedId,
  basePath,
  paramName,
}: {
  items: { id: string; name: string }[];
  selectedId: string;
  basePath: string;
  paramName: string;
}) {
  const router = useRouter();

  return (
    <select
      defaultValue={selectedId}
      onChange={(e) => router.push(`${basePath}?${paramName}=${e.target.value}`)}
      className="border border-gray-300 rounded px-2 py-1 text-sm"
    >
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}
