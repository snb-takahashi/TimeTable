"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import type { GenerationState } from "@/lib/generationProgress";

const POLL_INTERVAL_MS = 400;

// Reads the enclosing form's pending state via useFormStatus, which (unlike
// a plain useState set inside the action callback) is reliably painted for
// the whole duration of the action — a manually-managed flag set inside a
// <form action> callback runs as a low-priority transition update that
// React can skip rendering entirely when the action ends in a redirect.
function GenerateProgress({
  onPendingChange,
  onRequestConfirm,
}: {
  onPendingChange: (pending: boolean) => void;
  onRequestConfirm: () => void;
}) {
  const { pending } = useFormStatus();
  const [percent, setPercent] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);

  useEffect(() => {
    if (!pending) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    let cancelled = false;
    // A plain fetch to a Route Handler, not a Server Action call: actions
    // invoked from the same page are queued and dispatched one at a time by
    // React's client runtime, so a poll issued as an action would never
    // actually reach the server while runAutoGenerate is still in flight.
    const poll = async () => {
      const res = await fetch("/api/generation-progress", { cache: "no-store" });
      const state: GenerationState = await res.json();
      if (!cancelled && state.status === "running") setPercent(state.percent);
    };
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pending]);

  if (!pending) {
    return (
      <button
        type="button"
        onClick={onRequestConfirm}
        className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm cursor-pointer hover:bg-blue-700"
      >
        自動生成
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-32 h-2 rounded bg-gray-200 overflow-hidden">
        <div className="h-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-gray-600 tabular-nums">{percent}%</span>
    </div>
  );
}

export function AutoGenerateButton({
  action,
  classGroupId,
  classSelector,
  error,
  notice,
}: {
  action: (formData: FormData) => Promise<void>;
  classGroupId: string;
  classSelector: ReactNode;
  error?: string;
  notice?: string;
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">時間割</h1>
        <div className="flex items-center gap-3">
          {classSelector}
          <form ref={formRef} action={action}>
            <input type="hidden" name="classGroupId" value={classGroupId} />
            <GenerateProgress
              onPendingChange={setIsRunning}
              onRequestConfirm={() => setShowConfirm(true)}
            />
          </form>
        </div>
      </div>

      {!isRunning && error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {!isRunning && notice && (
        <p className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      )}

      {showConfirm && (
        // An in-app modal instead of window.confirm(): a native confirm()
        // dialog inside the Electron desktop build has been observed to
        // leave the window unable to receive further mouse input after the
        // dialog closes, so the confirmation step is implemented entirely
        // in React instead of relying on the browser's blocking dialog.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 max-w-sm rounded bg-white p-5 shadow-lg">
            <p className="mb-4 text-sm text-gray-800">
              学校全体の時間割をカリキュラム設定から自動生成します。既存の割当はすべて置き換えられます。よろしいですか?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  formRef.current?.requestSubmit();
                }}
                className="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                実行する
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
