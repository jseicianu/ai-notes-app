"use client";

import { useState } from "react";
import {
  Globe,
  FileText,
  Play,
  ExternalLink,
  Copy,
  BookOpen,
  RefreshCw,
  Clock,
  CheckCircle2,
  Database,
} from "lucide-react";
import type { Block } from "@/lib/models/types";

interface SourceCardBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

type SourceVariant = "web" | "pdf" | "youtube";

function detectVariant(content: Record<string, unknown>): SourceVariant {
  const url = (content.url as string) || "";
  const sourceType = (content.source_type as string) || "";

  if (sourceType === "youtube" || /youtu\.?be/.test(url)) return "youtube";
  if (sourceType === "pdf" || /\.pdf(\?|$)/i.test(url)) return "pdf";
  return "web";
}

function getVariantConfig(variant: SourceVariant) {
  switch (variant) {
    case "youtube":
      return {
        icon: Play,
        iconBg: "bg-red-50 border-red-100",
        iconColor: "text-red-600",
        typeLabel: "YOUTUBE TRANSCRIPT",
        badges: [
          { label: "YouTube", color: "text-red-600 bg-red-50 border-red-200" },
          { label: "Transcript", color: "text-orange-600 bg-orange-50 border-orange-200" },
          { label: "Source", color: "text-gray-500 bg-gray-50 border-gray-200" },
        ],
        refreshLabel: "Refresh transcript",
      };
    case "pdf":
      return {
        icon: FileText,
        iconBg: "bg-red-50 border-red-100",
        iconColor: "text-red-500",
        typeLabel: "PDF DOCUMENT",
        badges: [
          { label: "PDF", color: "text-red-600 bg-red-50 border-red-200" },
          { label: "File", color: "text-gray-500 bg-gray-50 border-gray-200" },
        ],
        refreshLabel: "Re-extract",
      };
    default:
      return {
        icon: Globe,
        iconBg: "bg-blue-50 border-blue-100",
        iconColor: "text-blue-600",
        typeLabel: "WEB ARTICLE",
        badges: [
          { label: "Web", color: "text-gray-500 bg-gray-50 border-gray-200" },
          { label: "Source", color: "text-gray-500 bg-gray-50 border-gray-200" },
        ],
        refreshLabel: "Refresh",
      };
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function estimateWordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[*-]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateNaturally(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const candidate = text.slice(0, maxLength);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf("! ")
  );
  if (sentenceEnd > maxLength * 0.55) {
    return `${candidate.slice(0, sentenceEnd + 1).trim()}...`;
  }

  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

export function SourceCardBlock({ block }: SourceCardBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const content = block.content || {};
  const url = (content.url as string) || "";
  const title = (content.title as string) || extractDomain(url);
  const summary = (content.summary as string) || "";
  const fullContent = (content.full_content as string) || (content.content as string) || "";
  const scrapedAt = (content.scraped_at as string) || block.created_at;
  const channelName = (content.channel_name as string) || "";
  const duration = (content.duration as string) || "";
  const pageCount = content.page_count as number | undefined;
  const fileSize = content.file_size as string | undefined;
  const isIndexed = (content.indexed as boolean) || false;

  const variant = detectVariant(content);
  const config = getVariantConfig(variant);
  const IconComponent = config.icon;

  const fullDisplayText = markdownToPlainText(fullContent || summary);
  const previewText = markdownToPlainText(summary || fullContent);
  const displayText = expanded ? fullDisplayText : previewText;
  const hasMoreContent = Boolean(fullContent && fullDisplayText.length > previewText.length + 40);
  const truncatedText = truncateNaturally(previewText, 280);
  const wordCount = estimateWordCount(fullDisplayText || previewText);

  const handleCopyUrl = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleOpenUrl = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const indexedBadge = isIndexed
    ? { label: "Indexed", color: "text-green-600 bg-green-50 border-green-200" }
    : null;

  const allBadges = indexedBadge ? [...config.badges, indexedBadge] : config.badges;

  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-3.5">
        {/* Type icon — larger, with border */}
        <div className={`shrink-0 h-11 w-11 rounded-xl border ${config.iconBg} flex items-center justify-center mt-0.5`}>
          <IconComponent className={`h-6 w-6 ${config.iconColor}`} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Type label + badges row */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-bold tracking-wider text-gray-400 uppercase">
              {config.typeLabel}
            </span>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {allBadges.map((badge) => (
                <span
                  key={badge.label}
                  className={`text-[12px] font-medium px-3 py-1 rounded-full border ${badge.color}`}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold text-gray-900 leading-snug mb-1">
            {title}
          </h3>

          {/* URL / channel row */}
          <div className="flex items-center gap-2 mb-2.5">
            {variant === "youtube" && channelName ? (
              <span className="text-[13px] text-blue-600 font-medium">
                {channelName}
                {duration && (
                  <span className="text-gray-400 font-normal ml-2">{duration}</span>
                )}
              </span>
            ) : url ? (
              <button
                onClick={handleOpenUrl}
                className="text-[13px] text-blue-600 hover:text-blue-700 hover:underline
                           flex items-center gap-1 truncate max-w-[400px] cursor-pointer"
              >
                {extractDomain(url)}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </button>
            ) : null}
          </div>

          {/* Content text with show more/less */}
          {displayText && (
            <p className="text-[13.5px] text-gray-600 leading-relaxed mb-2.5">
              {expanded ? displayText : truncatedText}
              {hasMoreContent && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-blue-600 hover:text-blue-700 ml-1.5 font-medium cursor-pointer"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
            </p>
          )}

          {/* Metadata row — dot separated */}
          <div className="flex items-center text-[12px] text-gray-400 mb-4 flex-wrap">
            {scrapedAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Scraped {formatRelativeTime(scrapedAt)}
              </span>
            )}
            {wordCount > 0 && (
              <>
                <span className="mx-2">·</span>
                <span>{wordCount.toLocaleString()} words</span>
              </>
            )}
            {variant === "pdf" && pageCount && (
              <>
                <span className="mx-2">·</span>
                <span>{pageCount} pages</span>
              </>
            )}
            {variant === "pdf" && fileSize && (
              <>
                <span className="mx-2">·</span>
                <span>{fileSize}</span>
              </>
            )}
            {variant === "youtube" && duration && (
              <>
                <span className="mx-2">·</span>
                <span>{duration}</span>
              </>
            )}
            {isIndexed && (
              <>
                <span className="mx-2">·</span>
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Indexed in memory
                </span>
              </>
            )}
          </div>

          {/* Action buttons — primary left, utility right */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <ActionButton icon={BookOpen} label="Summarize" />
              <ActionButton icon={Database} label="Use as source" />
              <ActionButton icon={RefreshCw} label={config.refreshLabel} />
            </div>
            <div className="flex-1" />
            {url && (
              <ActionButton
                icon={copiedUrl ? CheckCircle2 : Copy}
                label={copiedUrl ? "Copied!" : "Copy URL"}
                onClick={handleCopyUrl}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium
                 bg-white text-gray-600 border border-gray-200
                 hover:bg-gray-50 hover:text-gray-800 hover:border-gray-300
                 transition-colors cursor-pointer"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
