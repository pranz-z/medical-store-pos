"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IMPORT_MAX_BYTES, type ImportRowResult } from "@/lib/product-import-shared";

import { commitImportAction, dryRunImportAction } from "./actions";

/** Two-step CSV import: dry-run preview, then all-or-nothing commit. */
export function ImportForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRowResult[] | null>(null);
  const [validCount, setValidCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File | undefined) {
    setMessage(null);
    setRows(null);
    setCommitted(null);
    setCsvText(null);
    setFileName(null);
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setMessage(
        `File is ${Math.ceil(file.size / 1024)} KB — the cap is ${IMPORT_MAX_BYTES / 1024} KB.`,
      );
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    setCsvText(text);
    startTransition(async () => {
      const result = await dryRunImportAction(text);
      if (result.status === "error") {
        setMessage(result.message ?? "The file could not be read.");
        return;
      }
      setRows(result.rows ?? []);
      setValidCount(result.validCount ?? 0);
    });
  }

  function commit() {
    if (!csvText) return;
    setMessage(null);
    startTransition(async () => {
      const result = await commitImportAction(csvText);
      if (result.status === "error") {
        setMessage(result.message ?? "Import failed.");
        if (result.rows) setRows(result.rows);
        return;
      }
      setCommitted(result.created ?? 0);
      setRows(null);
      setCsvText(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  const invalidRows = rows?.filter((row) => !row.ok) ?? [];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {message ? (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        {committed !== null ? (
          <Alert>
            <AlertDescription>
              Imported {committed} product(s). They are live in the catalog now.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="text-sm"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
          <Button variant="outline" size="sm" asChild>
            <a href="/api/products/import-template">Download template</a>
          </Button>
        </div>
        {fileName ? (
          <p className="text-muted-foreground text-xs">
            {fileName} — {pending && rows === null ? "validating…" : null}
          </p>
        ) : null}

        {rows !== null ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="default">{validCount} valid</Badge>
              {invalidRows.length > 0 ? (
                <Badge variant="destructive">{invalidRows.length} with errors</Badge>
              ) : null}
            </div>

            {invalidRows.length > 0 ? (
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Line</th>
                      <th className="px-2 py-1.5 font-medium">SKU</th>
                      <th className="px-2 py-1.5 font-medium">Name</th>
                      <th className="px-2 py-1.5 font-medium">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invalidRows.map((row) => (
                      <tr key={row.line} className="border-t">
                        <td className="px-2 py-1.5 tabular-nums">{row.line}</td>
                        <td className="px-2 py-1.5 font-mono">{row.sku || "—"}</td>
                        <td className="px-2 py-1.5">{row.name || "—"}</td>
                        <td className="px-2 py-1.5">
                          <ul className="list-inside list-disc">
                            {row.errors.map((error, index) => (
                              <li key={index}>{error}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div>
              <Button
                onClick={commit}
                disabled={pending || validCount === 0 || invalidRows.length > 0}
              >
                {pending ? "Importing…" : `Commit ${validCount} product(s)`}
              </Button>
              {invalidRows.length > 0 ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  All-or-nothing: fix the failing rows and re-upload the file.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
