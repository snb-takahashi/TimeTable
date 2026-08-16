"use client";

export function AutoGenerateButton({
  action,
  classGroupId,
}: {
  action: (formData: FormData) => Promise<void>;
  classGroupId: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !confirm(
            "学校全体の時間割をカリキュラム設定から自動生成します。既存の割当はすべて置き換えられます。よろしいですか?"
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="classGroupId" value={classGroupId} />
      <button
        type="submit"
        className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm cursor-pointer hover:bg-blue-700"
      >
        自動生成
      </button>
    </form>
  );
}
