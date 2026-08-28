"use client";

import { useState, useRef } from "react";

export default function StoreUploadPage() {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    headers?: string[];
    skipped?: number;
    rowsInFile?: number;
    dryRun?: boolean;
    repCodes?: string[];
    unassigned?: { placeId: string; name: string; repCode: string }[];
    unassignedCount?: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * Merge is the default and always has been. Replace is the answer to "I loaded
   * a list of 60 and the rep still has 233": it makes the file authoritative for
   * the reps it names, instead of topping up whatever was already there.
   */
  const [replaceMode, setReplaceMode] = useState(false);
  /** The file held back from a real run, so Preview can be pressed then Apply. */
  const [pending, setPending] = useState<File | null>(null);

  const processFile = async (file: File, opts?: { dryRun?: boolean }) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      setResult({ ok: false, message: "Please upload an .xlsx or .xls file" });
      return;
    }
    // Replace can un-assign stores, so it is never the first thing that happens
    // to a file. The preview runs, and Apply is a separate, deliberate press.
    const dryRun = opts?.dryRun ?? (replaceMode && pending?.name !== file.name);
    setUploading(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    if (replaceMode) fd.append("mode", "replace");
    if (dryRun) fd.append("dryRun", "true");
    try {
      const res = await fetch("/api/stores/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        const added = data.added ?? 0;
        const updated = data.updated ?? 0;
        const noChange = added === 0 && updated === 0 && (data.skippedRows ?? 0) > 0;
        const unassignedCount = data.unassignedCount ?? 0;
        const tail = data.replaceAllocation
          ? `, ${unassignedCount} un-assigned from ${(data.repCodesInFile || []).length} rep${(data.repCodesInFile || []).length === 1 ? "" : "s"}`
          : "";
        setResult({
          ok: !noChange,
          message: noChange
            ? `No stores imported — ${data.skippedRows} of ${data.rowsInFile} rows skipped (missing Place ID or Store Name column).`
            : data.dryRun
              ? `Preview only, nothing saved: ${added} would be added, ${updated} updated${tail}.`
              : `${added} new stores added, ${updated} updated${tail} — ${data.total ?? 0} total stores, ${data.channels} channels, ${data.reps} reps`,
          headers: data.fileHeaders,
          skipped: data.skippedRows,
          rowsInFile: data.rowsInFile,
          dryRun: !!data.dryRun,
          repCodes: data.repCodesInFile,
          unassigned: data.unassigned,
          unassignedCount,
        });
        setPending(data.dryRun ? file : null);
      } else {
        setResult({ ok: false, message: data.error || "Upload failed" });
        setPending(null);
      }
    } catch {
      setResult({ ok: false, message: "Please close the file you're attempting to load" });
      setPending(null);
    }
    setUploading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Store Upload</h1>
      <p className="text-sm text-gray-500 mb-6">
        Upload an Excel file to import or update stores. Channels and reps will be auto-created if they don&apos;t exist.
      </p>

      {/* Mode */}
      <div className="mb-4 border border-gray-200 rounded-xl p-4 bg-white">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={replaceMode}
            onChange={(e) => { setReplaceMode(e.target.checked); setPending(null); setResult(null); }}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-gray-800">
              Replace the allocation for the reps in this file
            </span>
            <span className="block text-xs text-gray-500 mt-1">
              Normally an upload only adds and updates, so a rep keeps every store any
              earlier file ever gave them. With this ticked the file becomes the full
              list <strong>for the rep codes it contains</strong>: their other stores are
              un-assigned, not deleted, and no other rep is touched. You get a preview
              first.
            </span>
          </span>
        </label>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-clippa-red bg-red-50"
            : "border-gray-300 hover:border-clippa-red hover:bg-red-50/30"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          className="hidden"
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
            <p className="text-sm text-gray-600">Uploading and processing...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Drag & drop your Excel file here
              </p>
              <p className="text-xs text-gray-400 mt-1">or click to browse (.xlsx, .xls)</p>
            </div>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${
          result.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"
        }`}>
          <p>{result.message}</p>

          {/* What replace mode would do, before it does it. */}
          {result.dryRun && (
            <div className="mt-3 pt-3 border-t border-green-200">
              {result.repCodes && result.repCodes.length > 0 && (
                <p className="text-xs mb-2">
                  Reps in this file: <span className="font-mono">{result.repCodes.join(", ")}</span>
                </p>
              )}
              {(result.unassignedCount ?? 0) > 0 ? (
                <>
                  <p className="text-xs font-medium mb-1">
                    {result.unassignedCount} store{result.unassignedCount === 1 ? "" : "s"} would be un-assigned
                    {(result.unassignedCount ?? 0) > (result.unassigned?.length ?? 0) && ` (first ${result.unassigned?.length} shown)`}:
                  </p>
                  <div className="max-h-48 overflow-y-auto bg-white rounded border border-green-200 p-2">
                    {result.unassigned?.map((u) => (
                      <div key={u.placeId} className="text-[11px] text-gray-600 font-mono">
                        {u.repCode} · {u.placeId} · <span className="font-sans">{u.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs">Nothing would be un-assigned — the file already lists every store these reps carry.</p>
              )}
              <button
                onClick={() => pending && processFile(pending, { dryRun: false })}
                disabled={uploading || !pending}
                className="mt-3 px-3 py-1.5 rounded-lg bg-clippa-red text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                Apply to stores
              </button>
            </div>
          )}

          {result.headers && result.headers.length > 0 && !result.ok && (
            <div className="mt-2 pt-2 border-t border-amber-200">
              <p className="text-xs font-medium mb-1">Your file headers:</p>
              <div className="flex flex-wrap gap-1">
                {result.headers.map((h, i) => (
                  <span key={i} className="inline-block px-2 py-0.5 bg-white rounded text-[11px] border border-amber-200">{h}</span>
                ))}
              </div>
              <p className="text-[11px] mt-2 text-amber-600">
                The uploader needs a column matching &quot;PLACE ID&quot; or &quot;STORE ID&quot; and one matching &quot;PLACE NAME&quot; or &quot;STORE NAME&quot;.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Expected columns */}
      <div className="mt-8 bg-white border border-gray-100 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Expected Columns</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-500">
          <span>PLACE ID / STORE ID</span>
          <span>PLACE NAME / STORE NAME</span>
          <span>CHANNEL</span>
          <span>REPRESENTATIVE ID / REP CODE</span>
          <span>REPRESENTATIVE NAME / REP NAME</span>
          <span>GPS LATITUDE</span>
          <span>GPS LONGITUDE</span>
          <span>MONTHLY AVERAGE / VALUE</span>
          <span>ZONE (optional)</span>
          <span>REGION / PROVINCE / AREA (optional)</span>
        </div>
      </div>
    </div>
  );
}
