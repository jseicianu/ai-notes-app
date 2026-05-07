"use client";

import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CellHeaderAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface CellHeaderProps {
  icon: React.ReactNode;
  label: string;
  colorClass?: string;
  rightContent?: React.ReactNode;
  actions?: CellHeaderAction[];
  onDelete?: () => void;
  onDuplicate?: () => void;
}

const defaultColorClass = "text-cell-accent bg-cell-accent-light";

export function CellHeader({
  icon,
  label,
  colorClass = defaultColorClass,
  rightContent,
  actions = [],
  onDelete,
  onDuplicate,
}: CellHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-cell-header-bg border-b border-cell-border rounded-t-lg">
      {/* Left: type pill */}
      <div className="flex items-center gap-2">
        <div
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                      transition-colors ${colorClass}`}
        >
          {icon}
          <span>{label}</span>
        </div>
      </div>

      {/* Vertical divider */}
      <div className="h-5 w-px bg-gray-200 mx-2" />

      {/* Right: custom content + menu */}
      <div className="flex items-center gap-1.5">
        {rightContent}

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-7 w-7 items-center justify-center rounded-md
                       text-gray-400 hover:text-gray-600 hover:bg-gray-100
                       transition-all duration-150 cursor-pointer"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.label}
                onClick={action.onClick}
                disabled={action.disabled}
                className={`cursor-pointer ${
                  action.destructive ? "text-red-600 focus:text-red-600" : ""
                }`}
              >
                {action.icon && (
                  <span className="mr-2">{action.icon}</span>
                )}
                {action.label}
              </DropdownMenuItem>
            ))}
            {actions.length > 0 && (onDuplicate || onDelete) && (
              <DropdownMenuSeparator />
            )}
            {onDuplicate && (
              <DropdownMenuItem onClick={onDuplicate} className="cursor-pointer">
                Duplicate
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                onClick={onDelete}
                className="text-red-600 focus:text-red-600 cursor-pointer"
              >
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
