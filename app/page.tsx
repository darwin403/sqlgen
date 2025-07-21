"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef, memo, type ReactNode } from "react";
import { useQueryState } from "nuqs";
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
import { Loader2 } from "lucide-react";
import { X, Maximize2, Plus, RefreshCw } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback } from "react";

type TableSchema = { table: string; columns: { name: string; type: string }[] };
type QueryResult = { columns: string[]; rows: any[] };
type Connection = { name: string; uri: string };
type Message = { role: "user" | "assistant"; content: string };

const ChatMessage = memo(function ChatMessage({ msg }: { msg: Message }) {
  return (
    <div className={msg.role === "user" ? "self-end" : "self-start"}>
      <div
        className={`rounded px-3 py-2 text-sm ${
          msg.role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
});

export default function Home() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connQuery, setConnQuery] = useQueryState("conn");
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [leftWidth, setLeftWidth] = useState(50); // percent
  const [showOverlay, setShowOverlay] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  const [samplePrompts, setSamplePrompts] = useState<string[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);

  // Chat history state per connection
  type ChatHistory = {
    id: string;
    messages: Message[];
    created: number;
    title?: string;
    sql?: string;
    sqlEditable?: string;
    result?: QueryResult | null;
  };
  const [chatHistory, setChatHistory] = useState<Record<string, ChatHistory[]>>(
    {}
  );
  const [chatQuery, setChatQuery] = useQueryState("chat");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    if (schema.length > 0) {
      fetch("/api/sample-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
            setSamplePrompts(data.suggestions);
          }
        })
        .catch(() => {});
    }
  }, [schema]);

  useEffect(() => {
    const saved = localStorage.getItem("connections");
    if (saved) setConnections(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("connections", JSON.stringify(connections));
  }, [connections]);

  // Sync selectedIdx with URL (nuqs)
  useEffect(() => {
    if (connQuery !== undefined && connections.length > 0) {
      const idx = connections.findIndex((c) => c.name === connQuery);
      if (idx !== -1) setSelectedIdx(idx);
    }
  }, [connQuery, connections]);
  useEffect(() => {
    if (selectedIdx >= 0 && connections[selectedIdx]) {
      setConnQuery(connections[selectedIdx].name);
    }
  }, [selectedIdx, connections, setConnQuery]);

  useEffect(() => {
    if (selectedIdx >= 0 && connections[selectedIdx]) fetchSchema();
    // eslint-disable-next-line
  }, [selectedIdx]);

  // Calculate rows for textarea based on SQL length
  const sqlRows = Math.min(
    Math.max((sqlEditable.match(/\n/g)?.length ?? 0) + 1, 6),
    20
  );

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
    if (!prompt) return;
    setLoading(true);
    setRunLoading(false);
    setError("");
    setResult(null);
    setSql("");
    setSqlEditable("");
    // Add user message
    const newMessages = [
      ...messages,
      { role: "user" as "user", content: prompt },
    ];
    setMessages(newMessages);
    try {
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, schema }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate SQL");
      setSql(data.sql);
      setSqlEditable(data.sql);
      setMessages([
        ...newMessages,
        { role: "assistant" as "assistant", content: data.sql },
      ]);
      await runQuery(data.sql);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setPrompt("");
    }
  }

  async function runQuery(sqlToRun: string) {
    setRunLoading(true);
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
      setRunLoading(false);
    }
  }

  function toggleCollapse(table: string) {
    setCollapsed((prev) => ({ ...prev, [table]: !prev[table] }));
  }

  // Regenerate last assistant response
  const handleRegenerate = async () => {
    if (messages.length === 0) return;
    setRegenerating(true);
    setError("");
    // Remove the last assistant message
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (last.role !== "assistant") return setRegenerating(false);
    const newMessages = messages.slice(0, lastIdx);
    try {
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, schema }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate SQL");
      setSql(data.sql);
      setSqlEditable(data.sql);
      setMessages([
        ...newMessages,
        { role: "assistant" as "assistant", content: data.sql },
      ]);
      await runQuery(data.sql);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRegenerating(false);
    }
  };

  // Auto-fix error by asking LLM to fix the last query
  const handleAutoFix = async () => {
    if (!error) return;
    setAutoFixing(true);
    const fixMsg = `The previous SQL query returned this error: ${error}. Please fix the query and try again.`;
    // Add the auto-fix message as a user message and trigger LLM
    const newMessages = [
      ...messages,
      { role: "user" as "user", content: fixMsg },
    ];
    setMessages(newMessages);
    setPrompt("");
    try {
      setLoading(true);
      setRunLoading(false);
      setError("");
      setResult(null);
      setSql("");
      setSqlEditable("");
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, schema }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate SQL");
      setSql(data.sql);
      setSqlEditable(data.sql);
      setMessages([
        ...newMessages,
        { role: "assistant" as "assistant", content: data.sql },
      ]);
      await runQuery(data.sql);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setAutoFixing(false);
    }
  };

  // Memoize chat history rendering
  const chatHistoryRef = useRef<ReactNode[]>([]);
  useEffect(() => {
    chatHistoryRef.current = messages.map((msg, i) => (
      <div key={i} className={msg.role === "user" ? "self-end" : "self-start"}>
        <div
          className={`rounded px-3 py-2 text-sm ${
            msg.role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          } flex items-center gap-2`}
        >
          {msg.content}
          {/* Regenerate button for last assistant message */}
          {i === messages.length - 1 && msg.role === "assistant" && (
            <button
              className="ml-2 p-1 rounded hover:bg-muted-foreground/10 transition-colors text-xs flex items-center gap-1"
              onClick={handleRegenerate}
              disabled={regenerating}
              type="button"
              title="Regenerate response"
            >
              {regenerating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Regenerate
            </button>
          )}
        </div>
      </div>
    ));
  }, [messages, regenerating]);

  // Load chat history from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("chatHistory");
    if (saved) setChatHistory(JSON.parse(saved));
  }, []);
  // Save chat history to localStorage on change
  useEffect(() => {
    localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
  }, [chatHistory]);

  // When connection changes, reset activeChatId
  useEffect(() => {
    setActiveChatId(null);
  }, [selectedIdx]);

  // Sync activeChatId with URL (nuqs)
  useEffect(() => {
    if (
      chatQuery &&
      chatHistory[connections[selectedIdx]?.name]?.some(
        (c) => c.id === chatQuery
      )
    ) {
      setActiveChatId(chatQuery);
    }
  }, [chatQuery, chatHistory, connections, selectedIdx]);
  useEffect(() => {
    if (activeChatId) setChatQuery(activeChatId);
  }, [activeChatId, setChatQuery]);

  // Save new chat to history when messages, sql, or result change and there are messages
  useEffect(() => {
    if (selectedIdx < 0 || !connections[selectedIdx]) return;
    if (messages.length === 0) return;
    const connName = connections[selectedIdx].name;
    setChatHistory((prev) => {
      const prevChats = prev[connName] || [];
      // If editing an existing chat
      if (activeChatId) {
        return {
          ...prev,
          [connName]: prevChats.map((chat) =>
            chat.id === activeChatId
              ? { ...chat, messages: [...messages], sql, sqlEditable, result }
              : chat
          ),
        };
      }
      // New chat
      const newId = nanoid();
      setActiveChatId(newId);
      // Fetch title in parallel
      fetch("/api/llm/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.title) {
            setChatHistory((prev2) => {
              const chats = prev2[connName] || [];
              return {
                ...prev2,
                [connName]: chats.map((chat) =>
                  chat.id === newId ? { ...chat, title: data.title } : chat
                ),
              };
            });
          }
        })
        .catch(() => {});
      return {
        ...prev,
        [connName]: [
          {
            id: newId,
            messages: [...messages],
            created: Date.now(),
            title: undefined,
            sql,
            sqlEditable,
            result,
          },
          ...prevChats,
        ],
      };
    });
  }, [messages, sql, sqlEditable, result, selectedIdx]);

  // When loading a chat, if it has no title, fetch it
  useEffect(() => {
    if (selectedIdx < 0 || !connections[selectedIdx] || !activeChatId) return;
    const connName = connections[selectedIdx].name;
    const chat = (chatHistory[connName] || []).find(
      (c) => c.id === activeChatId
    );
    if (chat && !chat.title && chat.messages.length > 0) {
      fetch("/api/llm/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chat.messages }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.title) {
            setChatHistory((prev2) => {
              const chats = prev2[connName] || [];
              return {
                ...prev2,
                [connName]: chats.map((c) =>
                  c.id === chat.id ? { ...c, title: data.title } : c
                ),
              };
            });
          }
        })
        .catch(() => {});
    }
  }, [activeChatId, selectedIdx, chatHistory, connections]);

  // Load chat when selected from history
  const handleLoadChat = (id: string) => {
    if (selectedIdx < 0 || !connections[selectedIdx]) return;
    const connName = connections[selectedIdx].name;
    const chat = (chatHistory[connName] || []).find((c) => c.id === id);
    if (chat) {
      setMessages(chat.messages);
      setActiveChatId(id);
      setPrompt("");
      setSql(chat.sql || "");
      setSqlEditable(chat.sqlEditable || "");
      setResult(chat.result ?? null);
      setError("");
      setChatQuery(id);
    }
  };

  // Helper to handle sample prompt click
  const schemaRef = useRef(schema);
  const messagesRef = useRef(messages);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const handlePromptRef = useRef(handlePrompt);
  useEffect(() => {
    handlePromptRef.current = handlePrompt;
  }, [handlePrompt]);
  const handleSamplePrompt = useCallback((q: string) => {
    setPrompt(q);
    setTimeout(() => {
      if (messagesRef.current.length === 0) {
        handlePromptRef.current();
      }
    }, 0);
  }, []);

  // Resizer handlers
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.max(20, Math.min(80, percent)));
    }
    function onMouseUp() {
      isResizing.current = false;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

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
                    {t.columns
                      .map((col) => `${col.name} (${col.type})`)
                      .join(", ")}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </aside>
      {/* Main content */}
      <main
        ref={containerRef}
        className="flex-1 flex flex-row items-stretch px-0 py-0 gap-0 h-screen"
      >
        {/* Left: Chat interface */}
        <div
          className="flex flex-row h-full bg-background border-r"
          style={{ width: `${leftWidth}%`, minWidth: 200 }}
        >
          {/* Chat history sidebar (fixed left column in chat pane) */}
          {selectedIdx >= 0 &&
            connections[selectedIdx] &&
            (chatHistory[connections[selectedIdx].name]?.length ?? 0) > 0 && (
              <div className="flex flex-col w-44 bg-muted/40 border-r h-full">
                <div className="flex items-center justify-between text-xs font-semibold px-3 py-2 border-b">
                  <span>History</span>
                  <button
                    className="text-xs px-2 py-1 rounded hover:bg-muted-foreground/10 transition-colors"
                    onClick={() => {
                      const connName = connections[selectedIdx].name;
                      setChatHistory((prev) => {
                        const newHist = { ...prev };
                        delete newHist[connName];
                        return newHist;
                      });
                      setActiveChatId(null);
                    }}
                    type="button"
                    title="Clear history"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {(chatHistory[connections[selectedIdx].name] || []).map(
                    (chat) => (
                      <button
                        key={chat.id}
                        className={`w-full text-left px-3 py-2 text-xs border-b hover:bg-muted-foreground/10 transition-colors ${
                          activeChatId === chat.id
                            ? "bg-primary/10 font-bold"
                            : ""
                        }`}
                        onClick={() => handleLoadChat(chat.id)}
                      >
                        {chat.title ? chat.title : "Untitled"}
                        {chat.sql && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (SQL: {chat.sql.substring(0, 50)}...)
                          </span>
                        )}
                        {chat.result && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (Rows: {chat.result.rows.length})
                          </span>
                        )}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}
          {/* Chat area */}
          <div className="flex flex-col gap-6 h-full p-8 flex-1 relative">
            {/* New Chat button */}
            <button
              className="absolute top-0 right-0 mt-2 mr-2 p-2 rounded hover:bg-muted transition-colors flex items-center gap-1 text-xs"
              onClick={() => {
                setMessages([]);
                setPrompt("");
                setSql("");
                setSqlEditable("");
                setResult(null);
                setError("");
                setActiveChatId(null);
                setChatQuery(null);
              }}
              type="button"
              title="New Chat"
            >
              <Plus className="w-4 h-4" /> New Chat
            </button>
            {/* Conversation history */}
            {messages.length > 0 && (
              <div className="flex flex-col gap-3 mb-4">
                {chatHistoryRef.current}
              </div>
            )}
            <form
              className="flex flex-col gap-4 mt-auto"
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
              {/* Sample prompts as cards (show only if no user message yet) */}
              {messages.length === 0 && samplePrompts.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-3 justify-start">
                  {samplePrompts.map((q, i) => (
                    <Card
                      key={i}
                      className="cursor-pointer px-4 py-3 bg-muted hover:bg-primary/10 border-primary/20 transition-colors shadow-sm"
                      onClick={() => handleSamplePrompt(q)}
                    >
                      <span className="text-sm text-muted-foreground">{q}</span>
                    </Card>
                  ))}
                </div>
              )}
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
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="animate-spin w-4 h-4" /> Generating...
                  </span>
                ) : (
                  "Generate & Run SQL"
                )}
              </Button>
            </form>
          </div>
        </div>
        {/* Resizer */}
        <div
          className="w-2 cursor-col-resize bg-muted hover:bg-primary transition-colors"
          onMouseDown={() => {
            isResizing.current = true;
          }}
          style={{ zIndex: 10 }}
        />
        {/* Right: SQL and Results */}
        <div
          className="flex flex-col h-full overflow-y-auto bg-background"
          style={{ width: `${100 - leftWidth}%`, minWidth: 200 }}
        >
          <div className="flex flex-col gap-6 h-full p-8">
            {sql && (
              <div className="flex flex-col gap-2 mt-2">
                <div className="font-semibold">SQL Query</div>
                <div className="flex gap-2 items-start">
                  <textarea
                    className="w-full font-mono text-sm bg-muted rounded p-3 border min-h-[80px] max-h-[400px] overflow-auto"
                    value={sqlEditable}
                    onChange={(e) => setSqlEditable(e.target.value)}
                    disabled={loading}
                    rows={sqlRows}
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
                  disabled={loading || !sqlEditable || runLoading}
                >
                  {runLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="animate-spin w-4 h-4" /> Running...
                    </span>
                  ) : (
                    "Run SQL"
                  )}
                </Button>
              </div>
            )}
            {error && (
              <div className="text-red-500 text-sm mt-2 flex flex-col gap-2">
                <span>{error}</span>
                <Button
                  variant="outline"
                  className="w-fit text-xs"
                  onClick={handleAutoFix}
                  disabled={autoFixing}
                >
                  {autoFixing ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="animate-spin w-4 h-4" />{" "}
                      Auto-Fixing...
                    </span>
                  ) : (
                    "Auto-Fix"
                  )}
                </Button>
              </div>
            )}
            {/* Results */}
            {result && (
              <div className="flex flex-col gap-6 relative">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xl font-semibold">Results</div>
                  <button
                    className="p-2 rounded hover:bg-muted transition-colors"
                    onClick={() => setShowOverlay(true)}
                    title="Maximize results table"
                    aria-label="Maximize results table"
                    type="button"
                    disabled={result.rows.length === 0}
                  >
                    <Maximize2 className="w-5 h-5" />
                  </button>
                </div>
                {result.rows.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No results
                  </div>
                ) : (
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
                              <TableCell
                                key={col}
                                className="whitespace-nowrap"
                              >
                                {row[col]}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      {/* Overlay for maximized results table */}
      {showOverlay && result && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="relative bg-background rounded-lg shadow-2xl w-[90vw] h-[90vh] flex flex-col">
            <button
              className="absolute top-4 right-4 p-2 rounded hover:bg-muted transition-colors z-10"
              onClick={() => setShowOverlay(false)}
              aria-label="Close results overlay"
              type="button"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="flex-1 overflow-auto p-8">
              <div className="text-xl font-semibold mb-4">
                Results (Full View)
              </div>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
