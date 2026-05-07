"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Settings,
  Copy,
  Check,
  Globe,
  Plus,
  MoreVertical,
  Info,
  X,
  Terminal,
  Search,
  Target,
  FileInput,
  Braces,
  GitBranch,
} from "lucide-react";
import { Anthropic, OpenAI, Google, Ollama } from "@lobehub/icons";
import { createClient } from "@/lib/supabase/client";
import type { Command } from "@/lib/models/types";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SettingsPageProps {
  workspaceId: string;
  workspaceName: string;
  userEmail?: string;
}

type TabId = "general" | "ai-models" | "commands" | "integrations" | "members" | "billing";

interface WorkspaceSettings {
  description?: string;
  theme?: "light" | "dark" | "system";
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
    tavily?: string;
  };
  localModels?: {
    ollamaUrl?: string;
    lmStudioUrl?: string;
    modelName?: string;
  };
  defaultModel?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "ai-models", label: "AI & Models" },
  { id: "commands", label: "Commands" },
  { id: "integrations", label: "Integrations" },
  { id: "members", label: "Members" },
  { id: "billing", label: "Billing" },
];

const MODELS = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", subtitle: "Fast & capable", provider: "Anthropic", latency: "~1-2s", cost: "$$", Icon: Anthropic },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", subtitle: "Strong reasoning", provider: "Anthropic", latency: "~2-4s", cost: "$$$", Icon: Anthropic },
  { id: "gpt-4o", name: "GPT-4o", subtitle: "Latest", provider: "OpenAI", latency: "~1-2s", cost: "$$$", Icon: OpenAI },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", subtitle: "Fast & efficient", provider: "OpenAI", latency: "~0.6-1s", cost: "$", Icon: OpenAI },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", subtitle: "Long context", provider: "Google", latency: "~1-3s", cost: "$$", Icon: Google },
  { id: "local-ollama", name: "Local Model", subtitle: "Self-hosted", provider: "Ollama", latency: "~2-5s", cost: "Free", Icon: Ollama },
];

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", Icon: Anthropic, keyField: "anthropic" as const },
  { id: "openai", name: "OpenAI", Icon: OpenAI, keyField: "openai" as const },
  { id: "google", name: "Google", Icon: Google, keyField: "google" as const },
  { id: "tavily", name: "Tavily", Icon: Globe as React.ComponentType<{ size?: number }>, keyField: "tavily" as const },
  { id: "ollama", name: "Ollama (Local)", Icon: Ollama, keyField: null },
];

const COMMAND_TEMPLATE_GRID = "grid-cols-[40px_repeat(6,minmax(0,1fr))_32px]";

// ─── Hex Logo SVG ───────────────────────────────────────────────────────────

function CellNotesLogo({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M256 64 L415 156 L415 340 L256 448 L97 356 L97 156 Z"
        fill="none"
        stroke="#005BFF"
        strokeWidth="34"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
    </svg>
  );
}

// ─── Coming Soon Tooltip Wrapper ────────────────────────────────────────────

function ComingSoonTooltip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<span className="cursor-default" />}>{children}</TooltipTrigger>
        <TooltipContent side="top">Coming soon</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Toggle Switch ─────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors duration-200 cursor-pointer shrink-0
                 ${checked ? "bg-blue-500" : "bg-gray-300"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200
                   ${checked ? "translate-x-4" : "translate-x-0"}`}
      />
    </button>
  );
}

// ─── Toggle Row ────────────────────────────────────────────────────────────

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-b-0">
      <div className="min-w-0 mr-4">
        <p className="text-[13px] font-medium text-gray-700">{label}</p>
        <p className="text-[12px] text-gray-400">{description}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

// ─── Summary Row ───────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className="text-[13px] font-medium text-gray-900">{value}</span>
    </div>
  );
}

// ─── Quick Action ──────────────────────────────────────────────────────────

function QuickAction({ icon: Icon, label, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px]
                 text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
    >
      <Icon className="h-4 w-4 text-gray-400" />
      {label}
    </button>
  );
}

// ─── Settings Row (label + control) ─────────────────────────────────────────

function SettingsRow({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-b-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-medium text-gray-700">{label}</span>
        {info && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span className="cursor-help" />}>
                <Info className="h-3.5 w-3.5 text-gray-400" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">{info}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Styled Select (consistent width + chevron) ────────────────────────────

function StyledSelect({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className="w-[210px] border border-gray-200 rounded-md px-3 py-1.5 text-[13px]
                   appearance-none bg-white cursor-pointer pr-8
                   focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      >
        {children}
      </select>
      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
        <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}

// ─── Small bordered button ─────────────────────────────────────────────────

function SmallButton({ children, onClick, variant = "default" }: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary";
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer border
                  shrink-0 text-center
                 ${variant === "primary"
                   ? "bg-blue-500 hover:bg-blue-600 text-white border-blue-500"
                   : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
                 }`}
    >
      {children}
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function SettingsPage({ workspaceId, workspaceName }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [settings, setSettings] = useState<WorkspaceSettings>({});
  const [name, setName] = useState(workspaceName);
  const [description, setDescription] = useState("");
  const [commandCount, setCommandCount] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commands, setCommands] = useState<Command[]>([]);
  const [commandRunCount, setCommandRunCount] = useState(0);
  const [mostUsedCommand, setMostUsedCommand] = useState<string>("");
  const [commandSearchQuery, setCommandSearchQuery] = useState("");

  // API keys local state
  const [apiKeys, setApiKeys] = useState({
    anthropic: "",
    openai: "",
    google: "",
    tavily: "",
  });

  // Local models state
  const [localModels, setLocalModels] = useState({
    ollamaUrl: "",
    lmStudioUrl: "",
    modelName: "",
  });

  // Default model state
  const [defaultModel, setDefaultModel] = useState("claude-sonnet-4-6");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // ─── Load data ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const supabase = createClient();

    // Load workspace settings
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .single();

    if (workspace?.settings) {
      const s = workspace.settings as WorkspaceSettings;
      setSettings(s);
      setDescription(s.description || "");
      setApiKeys({
        anthropic: s.apiKeys?.anthropic || "",
        openai: s.apiKeys?.openai || "",
        google: s.apiKeys?.google || "",
        tavily: s.apiKeys?.tavily || "",
      });
      setLocalModels({
        ollamaUrl: s.localModels?.ollamaUrl || "",
        lmStudioUrl: s.localModels?.lmStudioUrl || "",
        modelName: s.localModels?.modelName || "",
      });
      setDefaultModel(s.defaultModel || "claude-sonnet-4-6");
    }

    // Load counts
    const { count: cmdCount } = await supabase
      .from("commands")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("is_archived", false);

    const { count: pgCount } = await supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    setCommandCount(cmdCount ?? 0);
    setPageCount(pgCount ?? 0);

    // Load commands list
    const { data: cmds } = await supabase
      .from("commands")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });
    setCommands((cmds as Command[]) ?? []);

    // Load command run stats
    const { count: cmdRunCount } = await supabase
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("type", "command");
    setCommandRunCount(cmdRunCount ?? 0);

    // Most used command
    if (cmds && cmds.length > 0) {
      const { data: topCmd } = await supabase
        .from("runs")
        .select("command_id")
        .eq("workspace_id", workspaceId)
        .eq("type", "command")
        .not("command_id", "is", null)
        .limit(100);
      if (topCmd && topCmd.length > 0) {
        const freq: Record<string, number> = {};
        for (const r of topCmd) { freq[r.command_id as string] = (freq[r.command_id as string] || 0) + 1; }
        const topId = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
        const topCommand = cmds.find((c: Command) => c.id === topId);
        setMostUsedCommand(topCommand ? `/${topCommand.slug}` : "—");
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // ─── Save helpers ─────────────────────────────────────────────────────────

  const saveWorkspaceProfile = async () => {
    setSaving(true);
    const supabase = createClient();

    const newSettings = { ...settings, description };
    await supabase.from("workspaces").update({ name, settings: newSettings }).eq("id", workspaceId);
    setSettings(newSettings);
    setSaving(false);
  };

  const saveApiKey = async (provider: keyof typeof apiKeys) => {
    const supabase = createClient();
    const newSettings = {
      ...settings,
      apiKeys: { ...settings.apiKeys, [provider]: apiKeys[provider] },
    };
    await supabase.from("workspaces").update({ settings: newSettings }).eq("id", workspaceId);
    setSettings(newSettings);
  };

  const saveLocalModels = async () => {
    const supabase = createClient();
    const newSettings = { ...settings, localModels };
    await supabase.from("workspaces").update({ settings: newSettings }).eq("id", workspaceId);
    setSettings(newSettings);
  };

  const copyWorkspaceId = () => {
    navigator.clipboard.writeText(workspaceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Truncate ID ──────────────────────────────────────────────────────────

  const truncatedId =
    workspaceId.length > 16
      ? `${workspaceId.slice(0, 8)}...${workspaceId.slice(-4)}`
      : workspaceId;

  // ─── Render tabs ──────────────────────────────────────────────────────────

  const renderGeneralTab = () => {
    const selectedModel = MODELS.find((m) => m.id === defaultModel) ?? MODELS[0];

    return (
      <div className="grid grid-cols-[1fr_1fr_300px] gap-4 grid-rows-[auto_auto]">
        {/* ── R1C1: Workspace Profile ── */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Workspace profile</h3>
          <p className="text-[13px] text-gray-500 mb-4">Update your workspace identity and description.</p>

          <div className="flex items-start gap-4 mb-3">
            <div className="flex flex-col items-center shrink-0">
              <div className="h-[64px] w-[64px] rounded-2xl bg-blue-50/50 border border-blue-100
                              flex items-center justify-center mb-1">
                <CellNotesLogo size={42} />
              </div>
              <ComingSoonTooltip>
                <button className="text-[11px] text-blue-500 hover:text-blue-600 font-medium cursor-pointer">
                  Change icon
                </button>
              </ComingSoonTooltip>
            </div>
            <div className="flex-1 space-y-2.5">
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1">Workspace name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-[13px]
                             focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Describe your workspace..."
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-[13px] resize-none
                             focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={saveWorkspaceProfile}
              disabled={saving}
              className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-[13px]
                         font-medium px-4 py-1.5 rounded-md transition-colors cursor-pointer"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>

        {/* ── R1C2: Default AI behavior ── */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Default AI behavior</h3>
          <p className="text-[13px] text-gray-500 mb-4">Set defaults for how AI responds in this workspace.</p>

          <div className="space-y-2">
            <div>
              <label className="block text-[13px] font-medium text-gray-700 mb-1">Default model</label>
              <div className="relative">
                <button
                  onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  className="w-full flex items-center gap-2 border border-gray-200 rounded-md px-3 py-1.5
                             text-[13px] text-left bg-white hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <selectedModel.Icon size={16} />
                  <span className="font-medium text-gray-900 flex-1">{selectedModel.name}</span>
                  <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {modelDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200
                                  rounded-md shadow-lg z-50 py-1"
                    onMouseLeave={() => setModelDropdownOpen(false)}
                  >
                    {MODELS.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => { setDefaultModel(model.id); setModelDropdownOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px]
                                    transition-colors cursor-pointer ${
                                      defaultModel === model.id ? "bg-blue-50" : "hover:bg-gray-50"
                                    }`}
                      >
                        <model.Icon size={16} />
                        <span className="font-medium text-gray-700">{model.name}</span>
                        {defaultModel === model.id && <Check className="ml-auto h-3.5 w-3.5 text-blue-500" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <ToggleRow
              label="Use workspace context by default"
              description="Include notebook context in new runs."
              checked={true}
              onChange={() => {}}
            />
            <ToggleRow
              label="Structured output preference"
              description="Prefer tables and JSON over plain text."
              checked={true}
              onChange={() => {}}
            />
          </div>
        </div>

        {/* ── R1C3: Workspace Summary ── */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Workspace Summary</h3>
          <p className="text-[13px] text-gray-500 mb-3">Overview of your workspace and usage.</p>

          <div className="space-y-0">
            <SummaryRow label="Plan" value="Personal" />
            <SummaryRow label="Commands" value={String(commandCount)} />
            <SummaryRow label="Pages" value={String(pageCount)} />
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[13px] text-gray-500">Workspace ID</span>
              <div className="flex items-center gap-1.5">
                <code className="text-[11px] font-mono text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                  {truncatedId}
                </code>
                <button
                  onClick={copyWorkspaceId}
                  className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                >
                  {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── R2C1: Notebook preferences ── */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Notebook & command preferences</h3>
          <p className="text-[13px] text-gray-500 mb-3">Control how commands run and results are displayed.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Auto-render command inputs"
              description="Automatically render inputs as structured blocks."
              checked={true}
              onChange={() => {}}
            />
            <ToggleRow
              label="Show run metadata"
              description="Display model, tokens, and timing on run outputs."
              checked={true}
              onChange={() => {}}
            />
            <ToggleRow
              label="Enable slash command suggestions"
              description="Show suggestions as you type in the command bar."
              checked={false}
              onChange={() => {}}
            />
          </div>
        </div>

        {/* ── R2C2: Appearance ── */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Appearance</h3>
          <p className="text-[13px] text-gray-500 mb-3">Customize the look and feel of your workspace.</p>

          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-1">Theme</label>
            <div className="relative">
              <select
                defaultValue="light"
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-[13px]
                           appearance-none bg-white cursor-pointer
                           focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 pr-8"
              >
                <option value="light">Light</option>
                <option value="dark">Dark (Coming soon)</option>
                <option value="system">System (Coming soon)</option>
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* ── R2C3: Quick actions ── */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Quick actions</h3>
          <p className="text-[13px] text-gray-500 mb-3">Common settings and tools.</p>

          <div className="space-y-1">
            <QuickAction icon={Settings} label="Manage API keys" onClick={() => setActiveTab("ai-models")} />
            <ComingSoonTooltip>
              <QuickAction icon={Globe} label="Invite member" />
            </ComingSoonTooltip>
            <ComingSoonTooltip>
              <QuickAction icon={Copy} label="Export workspace" />
            </ComingSoonTooltip>
          </div>
        </div>
      </div>
    );
  };

  const [enabledModels, setEnabledModels] = useState<Set<string>>(
    new Set(MODELS.map((m) => m.id))
  );
  const [runCount, setRunCount] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);

  useEffect(() => {
    async function loadAiStats() {
      const supabase = createClient();
      const { count } = await supabase
        .from("runs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "completed");
      setRunCount(count ?? 0);

      const { data: tokenData } = await supabase
        .from("runs")
        .select("token_usage")
        .eq("workspace_id", workspaceId)
        .eq("status", "completed")
        .not("token_usage", "is", null);

      let tokens = 0;
      for (const r of tokenData ?? []) {
        const u = r.token_usage as Record<string, number> | null;
        if (u?.total_tokens) tokens += u.total_tokens;
      }
      setTotalTokens(tokens);
    }
    loadAiStats();
  }, [workspaceId]);

  const renderAiModelsTab = () => {
    const selectedModel = MODELS.find((m) => m.id === defaultModel) ?? MODELS[0];
    const activeProviderCount = [
      apiKeys.anthropic, apiKeys.openai, apiKeys.google,
      localModels.ollamaUrl,
    ].filter(Boolean).length;

    return (
      <div className="grid grid-cols-[1fr_1fr_300px] gap-4 items-start">
        {/* ── Col 1: Routing + Provider config stacked ── */}
        <div className="flex flex-col gap-3">
          {/* Default model routing + behavior merged */}
          <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Model routing & behavior</h3>
            <p className="text-[13px] text-gray-500 mb-3">Configure defaults for how AI models are used.</p>

            <div className="space-y-0">
              <SettingsRow label="Default model">
                <div className="relative">
                  <button
                    onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                    className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-1.5
                               text-[13px] bg-white hover:bg-gray-50 transition-colors cursor-pointer w-[210px]"
                  >
                    <selectedModel.Icon size={16} />
                    <span className="font-medium text-gray-900 flex-1 truncate">{selectedModel.name}</span>
                    <svg className="h-3.5 w-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {modelDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 w-[210px] bg-white border border-gray-200
                                    rounded-md shadow-lg z-50 py-1" onMouseLeave={() => setModelDropdownOpen(false)}>
                      {MODELS.map((model) => (
                        <button key={model.id}
                          onClick={() => { setDefaultModel(model.id); setModelDropdownOpen(false); }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer
                                      ${defaultModel === model.id ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                          <model.Icon size={16} />
                          <span className="font-medium text-gray-700">{model.name}</span>
                          {defaultModel === model.id && <Check className="ml-auto h-3.5 w-3.5 text-blue-500" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </SettingsRow>
              <SettingsRow label="Structured outputs" info="Choose how the AI formats its responses.">
                <StyledSelect defaultValue="json">
                  <option value="json">Prefer structured outputs (JSON)</option>
                  <option value="text">Plain text</option>
                  <option value="auto">Auto-detect</option>
                </StyledSelect>
              </SettingsRow>
              <SettingsRow label="Tool use" info="Control when the AI uses notebook tools.">
                <StyledSelect defaultValue="auto">
                  <option value="auto">Auto (use tools when helpful)</option>
                  <option value="always">Always use tools</option>
                  <option value="never">Never use tools</option>
                </StyledSelect>
              </SettingsRow>
              <SettingsRow label="Temperature" info="Higher values produce more creative outputs.">
                <StyledSelect defaultValue="0.3">
                  <option>0.3</option><option>0.5</option><option>0.7</option><option>1.0</option>
                </StyledSelect>
              </SettingsRow>
              <SettingsRow label="Max output" info="Maximum number of tokens per response.">
                <StyledSelect defaultValue="2048">
                  <option value="2048">2048 tokens</option>
                  <option value="4096">4096 tokens</option>
                  <option value="8192">8192 tokens</option>
                </StyledSelect>
              </SettingsRow>
              <SettingsRow label="Schema validation" info="How to handle outputs that don't match the expected schema.">
                <StyledSelect defaultValue="repair">
                  <option value="repair">Validate & auto-repair</option>
                  <option value="validate">Validate only</option>
                  <option value="disabled">Disabled</option>
                </StyledSelect>
              </SettingsRow>

              <div className="border-t border-gray-100 pt-2 mt-1 space-y-0">
                <ToggleRow label="Model auto-selection" description="Route based on task complexity." checked={false} onChange={() => {}} />
                <ToggleRow label="Retry on validation failure" description="Auto-retry when schema check fails." checked={true} onChange={() => {}} />
              </div>
            </div>
          </div>

          {/* Provider configuration */}
          <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Provider configuration</h3>
            <p className="text-[13px] text-gray-500 mb-4">Manage API connections and provider status.</p>

            {/* Provider rows */}
            <div className="space-y-0">
              <div className="grid grid-cols-[1fr_90px_1fr_auto] gap-2 items-center pb-2">
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Provider</span>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Status</span>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">API connection</span>
                <span className="w-[72px]" />
              </div>
              {PROVIDERS.map((provider) => {
                const hasKey = provider.keyField ? !!apiKeys[provider.keyField] : !!localModels.ollamaUrl;
                const maskedKey = provider.keyField && apiKeys[provider.keyField]
                  ? `${apiKeys[provider.keyField].slice(0, 6)}${"·".repeat(10)}${apiKeys[provider.keyField].slice(-4)}`
                  : provider.id === "ollama" && localModels.ollamaUrl
                    ? localModels.ollamaUrl
                    : "";

                return (
                  <div key={provider.id}
                    className="grid grid-cols-[1fr_90px_1fr_auto] gap-2 items-center py-3
                               border-t border-gray-100 first:border-t-0">
                    <div className="flex items-center gap-2.5">
                      <provider.Icon size={20} />
                      <span className="text-[13px] font-medium text-gray-900">{provider.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${hasKey ? "bg-green-500" : "bg-gray-300"}`} />
                      <span className={`text-[12px] font-medium ${hasKey ? "text-green-600" : "text-gray-400"}`}>
                        {hasKey ? "Connected" : "Not set"}
                      </span>
                    </div>
                    <code className="text-[12px] font-mono text-gray-400 truncate">
                      {maskedKey || "—"}
                    </code>
                    <SmallButton onClick={() => {
                      const el = document.querySelector(`[data-provider="${provider.id}"]`) as HTMLInputElement;
                      el?.focus();
                    }}>
                      Manage
                    </SmallButton>
                  </div>
                );
              })}
            </div>

            {/* Inline key inputs */}
            <div className="mt-4 pt-4 border-t border-gray-200 space-y-2.5">
              {(["anthropic", "openai", "google", "tavily"] as const).map((key) => {
                const prov = PROVIDERS.find((p) => p.keyField === key)!;
                return (
                  <div key={key} className="flex items-center gap-2.5">
                    <prov.Icon size={16} />
                    <input
                      data-provider={prov.id}
                      type="password"
                      value={apiKeys[key]}
                      onChange={(e) => setApiKeys((k) => ({ ...k, [key]: e.target.value }))}
                      placeholder={`${prov.name} API key`}
                      className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-[13px]
                                 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <SmallButton onClick={() => saveApiKey(key)}>Save</SmallButton>
                  </div>
                );
              })}
              <div className="flex items-center gap-2.5">
                <Ollama size={16} />
                <input
                  type="text"
                  value={localModels.ollamaUrl}
                  onChange={(e) => setLocalModels((m) => ({ ...m, ollamaUrl: e.target.value }))}
                  placeholder="Ollama URL (http://localhost:11434)"
                  className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-[13px]
                             focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
                <SmallButton onClick={saveLocalModels}>Save</SmallButton>
              </div>
            </div>

            <ComingSoonTooltip>
              <button className="flex items-center gap-1.5 mt-4 text-[13px] text-blue-500 hover:text-blue-600
                                 font-medium cursor-pointer transition-colors">
                <Plus className="h-3.5 w-3.5" />
                Connect provider
              </button>
            </ComingSoonTooltip>
          </div>
        </div>

        {/* ── Col 2: Available models (scrollable) ── */}
        <div className="border border-gray-200 rounded-lg bg-white flex flex-col">
          <div className="flex items-start justify-between p-5 pb-3">
            <div>
              <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Available models</h3>
              <p className="text-[13px] text-gray-500">Enable or disable models available to your workspace.</p>
            </div>
            <ComingSoonTooltip>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200
                                 text-[12px] font-medium text-gray-700 hover:bg-gray-50
                                 transition-colors cursor-pointer shrink-0">
                <Plus className="h-3.5 w-3.5" />
                Add custom model
              </button>
            </ComingSoonTooltip>
          </div>

          <div className="px-5 pb-5">
            <div className="grid grid-cols-[1fr_70px_80px_70px_20px] gap-2 items-center mb-1">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Model</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Provider</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-center">Latency / Cost</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-center">Status</span>
              <span />
            </div>
            {MODELS.map((model) => {
              const enabled = enabledModels.has(model.id);
              return (
                <div key={model.id} className="grid grid-cols-[1fr_70px_80px_70px_20px] gap-2 items-center py-2.5
                                                border-t border-gray-100 first:border-t-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <model.Icon size={20} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-900 truncate">{model.name}</p>
                      <p className="text-[11px] text-gray-400">{model.subtitle}</p>
                    </div>
                  </div>
                  <span className="text-[12px] text-gray-500">{model.provider}</span>
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="text-[11px] text-gray-400">{model.latency}</span>
                    <span className="text-[11px] font-medium text-gray-500">{model.cost}</span>
                  </div>
                  <div className="flex items-center justify-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-green-500" : "bg-gray-300"}`} />
                    <ToggleSwitch checked={enabled} onChange={(v) => {
                      setEnabledModels((prev) => {
                        const next = new Set(prev);
                        if (v) next.add(model.id); else next.delete(model.id);
                        return next;
                      });
                    }} />
                  </div>
                  <ComingSoonTooltip>
                    <button className="text-gray-400 hover:text-gray-600 cursor-pointer">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </ComingSoonTooltip>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Col 3: AI Summary + Safety stacked ── */}
        <div className="flex flex-col gap-3">
          <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">AI Summary</h3>
            <p className="text-[13px] text-gray-500 mb-3">Overview of your AI setup and usage.</p>

            <div className="space-y-2.5">
              <div>
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5">Active providers</p>
                <div className="flex items-center gap-1.5">
                  {PROVIDERS.filter((p) => {
                    if (p.keyField === null) return !!localModels.ollamaUrl;
                    return !!apiKeys[p.keyField];
                  }).map((p) => (
                    <div key={p.id} className="h-7 w-7 rounded-md bg-gray-50 border border-gray-200
                                               flex items-center justify-center">
                      <p.Icon size={15} />
                    </div>
                  ))}
                  {activeProviderCount === 0 && (
                    <span className="text-[11px] text-gray-400 italic">None connected</span>
                  )}
                  {activeProviderCount > 0 && (
                    <span className="text-[11px] text-blue-500 font-medium ml-auto">{activeProviderCount} active</span>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-2">
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">Default model</p>
                <div className="flex items-center gap-1.5">
                  <selectedModel.Icon size={14} />
                  <span className="text-[12px] font-medium text-gray-900">{selectedModel.name}</span>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-2">
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5">Usage</p>
                <SummaryRow label="Total runs" value={String(runCount)} />
                <SummaryRow label="Total tokens" value={totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : String(totalTokens)} />
              </div>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Safety & guardrails</h3>
            <p className="text-[13px] text-gray-500 mb-3">Keep outputs safe and aligned.</p>

            <div className="space-y-0">
              <ToggleRow label="PII redaction" description="Redact personal information." checked={false} onChange={() => {}} />
              <ToggleRow label="Require citations" description="Citations for factual claims." checked={false} onChange={() => {}} />
              <ToggleRow label="Content filter" description="Filter harmful content." checked={true} onChange={() => {}} />
              <ToggleRow label="Block injection" description="Detect injection attempts." checked={true} onChange={() => {}} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const filteredCommands = commands.filter((c) =>
    !commandSearchQuery || c.name.toLowerCase().includes(commandSearchQuery.toLowerCase()) ||
    c.slug.toLowerCase().includes(commandSearchQuery.toLowerCase())
  );

  const renderCommandsTab = () => (
    <div className="space-y-4">
      {/* Row 1: Command defaults (wide) + Command Summary */}
      <div className="grid grid-cols-[1fr_300px] gap-4 items-start">
        {/* Command defaults */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Command defaults</h3>
          <p className="text-[13px] text-gray-500 mb-4">Set default behavior for new and custom commands.</p>

          <div className="flex gap-0">
            {/* Left — toggles */}
            <div className="flex-1 pr-6 space-y-0">
              <ToggleRow
                label="Enable slash command suggestions"
                description="Show suggestions when typing / in the command bar."
                checked={true}
                onChange={() => {}}
              />
              <ToggleRow
                label="Auto-render command inputs"
                description="Automatically render inputs as structured blocks."
                checked={true}
                onChange={() => {}}
              />
            </div>

            {/* Vertical divider */}
            <div className="w-px bg-gray-200 mx-0 self-stretch" />

            {/* Right — output blocks + metadata */}
            <div className="flex-1 pl-6 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1">Default output blocks</label>
                <p className="text-[12px] text-gray-400 mb-2">Choose the blocks to add by default to new commands.</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {["Table", "JSON", "Summary"].map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
                                               border border-blue-200 bg-blue-50 text-[12px] font-medium text-blue-600">
                      {tag}
                      <button className="text-blue-400 hover:text-blue-600 cursor-pointer">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <ComingSoonTooltip>
                    <button className="h-7 w-7 flex items-center justify-center rounded-md
                                       border border-dashed border-gray-300 text-gray-400
                                       hover:border-gray-400 hover:text-gray-500 cursor-pointer">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </ComingSoonTooltip>
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1">Default metadata visibility</label>
                <p className="text-[12px] text-gray-400 mb-1.5">Choose the default visibility for metadata in command outputs.</p>
                <div className="relative">
                  <select
                    defaultValue="show"
                    className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-[13px]
                               appearance-none bg-white cursor-pointer pr-8
                               focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="show">Show metadata</option>
                    <option value="hide">Hide metadata</option>
                    <option value="collapsed">Collapsed by default</option>
                  </select>
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Command Summary */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Command Summary</h3>
          <p className="text-[13px] text-gray-500 mb-3">Overview of your workspace commands.</p>

          <div className="space-y-0">
            <SummaryRow label="Total commands" value={String(commandCount)} />
            <SummaryRow label="Most-used command" value={mostUsedCommand || "—"} />
            <SummaryRow label="Runs this month" value={String(commandRunCount)} />
          </div>
        </div>
      </div>

      {/* Row 2: Command templates table — same width as row above */}
      <div className="grid grid-cols-[1fr_300px] gap-4">
        <div className="border border-gray-200 rounded-lg bg-white">
          <div className="flex items-center justify-between p-5 pb-3">
            <div>
              <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Command templates</h3>
              <p className="text-[13px] text-gray-500">Manage reusable commands available to your workspace.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  value={commandSearchQuery}
                  onChange={(e) => setCommandSearchQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="pl-8 pr-3 py-1.5 w-[180px] border border-gray-200 rounded-md text-[13px]
                             focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <ComingSoonTooltip>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200
                                   text-[13px] font-medium text-gray-700 hover:bg-gray-50
                                   transition-colors cursor-pointer">
                  <Plus className="h-3.5 w-3.5" />
                  New template
                </button>
              </ComingSoonTooltip>
            </div>
          </div>

          <div className="px-5 pb-5">
            {/* Table header — icon spacer + columns */}
            <div className={`grid ${COMMAND_TEMPLATE_GRID} gap-4 items-center py-2 border-b border-gray-200`}>
              <span />
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Command</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Trigger</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-center">Inputs</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-center">Output type</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-center">Version</span>
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider text-center">Status</span>
              <span />
            </div>

            {/* Command rows */}
            {filteredCommands.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-gray-400">
                {commands.length === 0 ? "No commands created yet" : "No matching commands"}
              </div>
            ) : (
              filteredCommands.map((cmd) => (
                <div
                  key={cmd.id}
                  className={`grid ${COMMAND_TEMPLATE_GRID} gap-4 items-center py-3 border-b border-gray-100 last:border-b-0`}
                >
                  <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Terminal className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-gray-900 truncate">{cmd.name}</p>
                    <p className="text-[11px] text-gray-400 truncate">{cmd.description || "No description"}</p>
                  </div>
                  <code className="text-[12px] font-mono text-gray-500 truncate">/{cmd.slug}</code>
                  <span className="text-[13px] text-gray-700 text-center">{cmd.inputs?.length ?? 0}</span>
                  <span className="text-[12px] text-gray-500 text-center truncate">
                    {cmd.output_schema && Object.keys(cmd.output_schema).length > 0 ? "Table + JSON" : "Summary"}
                  </span>
                  <span className="text-[12px] text-gray-500 text-center">{cmd.version}.0</span>
                  <div className="flex justify-center">
                    <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-green-50 text-green-600 border border-green-200">
                      Published
                    </span>
                  </div>
                  <ComingSoonTooltip>
                    <button className="text-gray-400 hover:text-gray-600 cursor-pointer">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </ComingSoonTooltip>
                </div>
              ))
            )}
          </div>

          {commands.length > 0 && (
            <div className="px-5 pb-4 border-t border-gray-100">
              <button className="flex items-center gap-1.5 mt-3 text-[13px] text-blue-500 hover:text-blue-600
                                 font-medium cursor-pointer transition-colors">
                View all commands
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>
        {/* Best practices — right column, directly under Command Summary */}
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Best practices</h3>
          <p className="text-[13px] text-gray-500 mb-3">Build great reusable commands.</p>

          <div className="space-y-3">
            {[
              { icon: Target, title: "Keep commands focused", desc: "One clear purpose per command." },
              { icon: FileInput, title: "Use strong inputs", desc: "Validate inputs and provide examples." },
              { icon: Braces, title: "Return structured outputs", desc: "Prefer tables or JSON for consistency." },
              { icon: GitBranch, title: "Version with care", desc: "Test changes and document updates." },
            ].map((tip) => (
              <div key={tip.title} className="flex items-start gap-2.5">
                <div className="h-7 w-7 rounded-md bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
                  <tip.icon className="h-3.5 w-3.5 text-blue-500" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-gray-900">{tip.title}</p>
                  <p className="text-[12px] text-gray-400">{tip.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Versioning + Discovery (left only, same width as templates) */}
      <div className="grid grid-cols-[1fr_300px] gap-4 items-start">
        <div className="grid grid-cols-2 gap-4">
          {/* Versioning & testing */}
          <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Versioning & testing</h3>
            <p className="text-[13px] text-gray-500 mb-3">Configure version control and safe testing.</p>

            <div className="space-y-0">
              <ToggleRow label="Enable version history" description="Track changes and maintain versions." checked={true} onChange={() => {}} />
              <ToggleRow label="Validate command schemas" description="Check input/output schemas before saving." checked={true} onChange={() => {}} />
              <ToggleRow label="Store run logs" description="Keep execution logs for audit and debugging." checked={true} onChange={() => {}} />
            </div>
          </div>

          {/* Discovery & organization */}
          <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">Discovery & organization</h3>
            <p className="text-[13px] text-gray-500 mb-3">Make commands easy to find and use.</p>

            <div className="space-y-2">
              <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
                <div>
                  <p className="text-[13px] font-medium text-gray-700">Categories</p>
                  <p className="text-[12px] text-gray-400">Organize commands with categories.</p>
                </div>
                <ComingSoonTooltip>
                  <div className="relative">
                    <select className="border border-gray-200 rounded-md px-3 py-1.5 text-[13px] bg-white cursor-default w-[110px] appearance-none pr-7">
                      <option>Enabled</option>
                    </select>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </ComingSoonTooltip>
              </div>
              <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
                <div>
                  <p className="text-[13px] font-medium text-gray-700">Tags</p>
                  <p className="text-[12px] text-gray-400">Allow tagging commands.</p>
                </div>
                <ComingSoonTooltip>
                  <div className="relative">
                    <select className="border border-gray-200 rounded-md px-3 py-1.5 text-[13px] bg-white cursor-default w-[110px] appearance-none pr-7">
                      <option>Enabled</option>
                    </select>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </ComingSoonTooltip>
              </div>
              <ToggleRow label="Search indexing" description="Include commands in global search." checked={true} onChange={() => {}} />
            </div>
          </div>
        </div>
        <div />
      </div>
    </div>
  );

  const renderComingSoon = () => (
    <div className="flex items-center justify-center h-64">
      <p className="text-[14px] text-gray-400 font-medium">Coming soon</p>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return renderGeneralTab();
      case "ai-models":
        return renderAiModelsTab();
      case "commands":
        return renderCommandsTab();
      default:
        return renderComingSoon();
    }
  };

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <div className="flex-1 h-full overflow-y-auto bg-white">
      <div className="px-10 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-1.5">
            <Settings className="h-5 w-5 text-gray-700" />
            <h1 className="text-[22px] font-semibold text-gray-900">Settings</h1>
          </div>
          <p className="text-[14px] text-gray-500">
            Manage your workspace, AI behavior, team access, and preferences.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-gray-200 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-[13px] font-medium transition-colors cursor-pointer relative
                ${
                  activeTab === tab.id
                    ? "text-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 rounded-t" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {renderContent()}
      </div>
    </div>
  );
}
