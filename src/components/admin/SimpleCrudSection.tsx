import { CsvUploadForm } from "@/components/admin/CsvUploadForm";

type Item = {
  id: string;
  name: string;
  extra?: string | null;
};

export function SimpleCrudSection({
  title,
  items,
  extraFieldLabel,
  createAction,
  deleteAction,
  error,
  notice,
  csvUploadAction,
  csvColumnsHint,
}: {
  title: string;
  items: Item[];
  extraFieldLabel?: string;
  createAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  error?: string;
  notice?: string;
  csvUploadAction?: (formData: FormData) => Promise<void>;
  csvColumnsHint?: string;
}) {
  return (
    <section className="max-w-xl">
      <h1 className="text-xl font-semibold mb-4">{title}</h1>

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

      {csvUploadAction && csvColumnsHint && (
        <CsvUploadForm action={csvUploadAction} columnsHint={csvColumnsHint} />
      )}

      <ul className="mb-6 divide-y divide-gray-200 border border-gray-200 rounded">
        {items.length === 0 && (
          <li className="px-3 py-2 text-sm text-gray-500">まだ登録がありません</li>
        )}
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between px-3 py-2 text-sm"
          >
            <span>
              {item.name}
              {item.extra ? (
                <span className="ml-2 text-gray-500">({item.extra})</span>
              ) : null}
            </span>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={item.id} />
              <button
                type="submit"
                className="text-red-600 hover:underline cursor-pointer"
              >
                削除
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={createAction} className="flex gap-2 items-end flex-wrap">
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
        {extraFieldLabel && (
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1" htmlFor="extra">
              {extraFieldLabel}
            </label>
            <input
              id="extra"
              name="extra"
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
        )}
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
