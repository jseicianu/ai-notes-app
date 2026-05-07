"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Bell } from "lucide-react";

interface BreadcrumbBarProps {
  workspaceName: string;
  userName?: string;
  userAvatarUrl?: string;
}

export function BreadcrumbBar({
  workspaceName,
}: BreadcrumbBarProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  return (
    <div className="flex items-center justify-between h-[52px] px-5 border-b border-gray-200 bg-white shrink-0">
      {/* Left — Logo + workspace name */}
      <div className="flex items-center gap-3" ref={menuRef}>
        {/* Cell Notes logo — circular blue gradient */}
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600
                        flex items-center justify-center shrink-0 shadow-sm">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3" stroke="white" strokeWidth="1.5" fill="none" />
            <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-1.5 cursor-pointer
                       hover:opacity-80 transition-opacity duration-150"
          >
            <span className="text-[15px] font-semibold text-gray-900">
              {workspaceName}
            </span>
            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200
              ${showMenu ? "rotate-180" : ""}`}
            />
          </button>

          {showMenu && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white border border-gray-200
                            rounded-lg shadow-lg py-1 z-50
                            animate-in fade-in slide-in-from-top-1 duration-100">
              <div className="px-3 py-2 text-[12px] font-medium text-gray-400 uppercase tracking-wider">
                Workspaces
              </div>
              <button
                onClick={() => setShowMenu(false)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px]
                           text-gray-900 font-medium bg-gray-50 cursor-pointer"
              >
                <div className="h-5 w-5 rounded-full bg-gradient-to-br from-blue-400 to-blue-600
                                flex items-center justify-center shrink-0">
                  <span className="text-[8px] font-bold text-white">
                    {workspaceName.charAt(0).toUpperCase()}
                  </span>
                </div>
                {workspaceName}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right — notification bell */}
      <button className="h-8 w-8 flex items-center justify-center rounded-lg
                         text-gray-400 hover:text-gray-600 hover:bg-gray-100
                         transition-colors duration-150 cursor-pointer">
        <Bell className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
