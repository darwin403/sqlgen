"use client";

import { useState, useEffect } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

type TableSchema = { table: string; columns: string[] };
type QueryResult = { columns: string[]; rows: any[] };
type Connection = { name: string; uri: string };

export default function Home() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [newConnName, setNewConnName] = useState("");
  const [newConnUri, setNewConnUri] = useState("");
  const [schema, setSchema] = useState<TableSchema[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState("");
  const [sql, setSql] = useState("");
  const [sqlEditable, setSqlEditable] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("connections");
    if (saved) setConnections(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("connections", JSON.stringify(connections));
  }, [connections]);

  useEffect(() => {
    if (selectedIdx >= 0 && connections[selectedIdx]) fetchSchema();
    // eslint-disable-next-line
  }, [selectedIdx]);

  async function fetchSchema() {
    setLoading(true);
    setError("");
    setSchema([]);
    setResult(null);
    setSql("");
    setSqlEditable("");
    try {
      const res = await fetch("/api/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: connections[selectedIdx].uri }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch schema");
      setSchema(data);
      setCollapsed(
        Object.fromEntries(data.map((t: TableSchema) => [t.table, true]))
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function addConnection() {
    if (!newConnName || !newConnUri) return;
    setConnections((prev) => [...prev, { name: newConnName, uri: newConnUri }]);
    setNewConnName("");
    setNewConnUri("");
  }

  function removeConnection(idx: number) {
    setConnections((prev) => prev.filter((_, i) => i !== idx));
    if (selectedIdx === idx) setSelectedIdx(-1);
    else if (selectedIdx > idx) setSelectedIdx((i) => i - 1);
  }

  async function handlePrompt() {
    setLoading(true);
    setError("");
    setResult(null);
    setSql("");
    setSqlEditable("");
    try {
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, schema }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate SQL");
      setSql(data.sql);
      setSqlEditable(data.sql);
      await runQuery(data.sql);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runQuery(sqlToRun: string) {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uri: connections[selectedIdx].uri,
          sql: sqlToRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run query");
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleCollapse(table: string) {
    setCollapsed((prev) => ({ ...prev, [table]: !prev[table] }));
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-80 min-h-screen bg-muted border-r flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <div className="text-lg font-semibold">Connections</div>
          <div className="flex gap-2">
            <Input
              placeholder="Name"
              value={newConnName}
              onChange={(e) => setNewConnName(e.target.value)}
              className="w-24"
              disabled={loading}
            />
            <Input
              placeholder="postgres://user:pass@host:port/db"
              value={newConnUri}
              onChange={(e) => setNewConnUri(e.target.value)}
              className="flex-1"
              disabled={loading}
            />
            <Button
              onClick={addConnection}
              disabled={loading || !newConnName || !newConnUri}
            >
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {connections.map((c, i) => (
              <div
                key={i}
                className={`flex items-center gap-1 px-2 py-1 rounded ${
                  selectedIdx === i
                    ? "bg-primary text-primary-foreground"
                    : "bg-background border"
                }`}
              >
                <button
                  onClick={() => setSelectedIdx(i)}
                  className="font-medium focus:outline-none"
                >
                  {c.name}
                </button>
                <button
                  onClick={() => removeConnection(i)}
                  className="text-xs ml-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        {selectedIdx >= 0 && schema.length > 0 && (
          <div className="flex flex-col gap-2 mt-6">
            <div className="text-base font-semibold mb-1">
              Tables ({schema.length})
            </div>
            {schema.map((t) => (
              <Card
                key={t.table}
                className="p-3 bg-background cursor-pointer select-none"
                onClick={() => toggleCollapse(t.table)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.table}</span>
                  <span className="text-xs text-muted-foreground">
                    {collapsed[t.table] ? "▼" : "▲"}
                  </span>
                </div>
                {collapsed[t.table] && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {t.columns.join(", ")}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </aside>
      {/* Main content */}
      <main className="flex-1 flex flex-col items-center px-4 py-12 gap-8">
        {/* Prompt and SQL Card */}
        <Card className="w-full max-w-2xl p-8 flex flex-col gap-6 shadow-lg">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading && prompt && selectedIdx >= 0 && schema.length > 0)
                handlePrompt();
            }}
            autoComplete="off"
          >
            <div className="text-2xl font-bold text-center mb-2">
              Ask your database
            </div>
            <Input
              id="prompt"
              placeholder="e.g. Show all users"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading || selectedIdx < 0 || schema.length === 0}
              className="text-lg py-6 px-4"
            />
            <Button
              className="w-fit self-end"
              type="submit"
              disabled={
                loading || !prompt || selectedIdx < 0 || schema.length === 0
              }
            >
              {loading ? "Generating & Running..." : "Generate & Run SQL"}
            </Button>
          </form>
          {sql && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="font-semibold">SQL Query</div>
              <div className="flex gap-2 items-start">
                <textarea
                  className="w-full font-mono text-sm bg-muted rounded p-3 min-h-[80px] border"
                  value={sqlEditable}
                  onChange={(e) => setSqlEditable(e.target.value)}
                  disabled={loading}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-fit mt-1"
                  onClick={async () => {
                    await navigator.clipboard.writeText(sqlEditable);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                  disabled={loading}
                >
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <Button
                className="w-fit self-end"
                onClick={() => runQuery(sqlEditable)}
                disabled={loading || !sqlEditable}
              >
                Run SQL
              </Button>
            </div>
          )}
          {error && <div className="text-red-500 text-sm mt-2">{error}</div>}
        </Card>
        {/* Results Card */}
        {result && result.rows.length > 0 && (
          <Card className="w-full max-w-5xl p-8 flex flex-col gap-6 shadow-lg">
            <div className="text-xl font-semibold mb-4">Results</div>
            <div className="overflow-x-auto">
              <Table className="w-full">
                <TableHeader>
                  <TableRow>
                    {result.columns.map((col) => (
                      <TableHead
                        key={col}
                        className="capitalize whitespace-nowrap"
                      >
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, i) => (
                    <TableRow key={i}>
                      {result.columns.map((col) => (
                        <TableCell key={col} className="whitespace-nowrap">
                          {row[col]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
