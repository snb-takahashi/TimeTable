export function CsvUploadForm({
  action,
  columnsHint,
}: {
  action: (formData: FormData) => Promise<void>;
  columnsHint: string;
}) {
  return (
    <form
      action={action}
      className="mb-6 flex items-end gap-2 rounded border border-gray-200 p-3"
    >
      <div className="flex flex-col">
        <label className="text-xs text-gray-600 mb-1" htmlFor="file">
          CSVファイル(1行目はヘッダー: {columnsHint})
        </label>
        <input
          id="file"
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm"
        />
      </div>
      <button
        type="submit"
        className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-900"
      >
        CSVアップロード
      </button>
    </form>
  );
}
