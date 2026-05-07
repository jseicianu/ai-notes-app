import type { LucideIcon } from "lucide-react";

interface DuotoneIconProps {
  icon: LucideIcon;
  size?: number;
  className?: string;
  offsetX?: number;
  offsetY?: number;
  fillClass?: string;
  strokeClass?: string;
}

export function DuotoneIcon({
  icon: Icon,
  size = 14,
  className = "",
  offsetX = 1.5,
  offsetY = 1.5,
  fillClass = "text-indigo-200",
  strokeClass = "text-indigo-500",
}: DuotoneIconProps) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`}
          style={{ width: size + offsetX, height: size + offsetY }}>
      <Icon
        size={size}
        className={`absolute fill-current opacity-60 ${fillClass}`}
        style={{ top: offsetY, left: offsetX }}
        strokeWidth={0}
      />
      <Icon
        size={size}
        className={`absolute ${strokeClass}`}
        style={{ top: 0, left: 0 }}
        strokeWidth={1.8}
      />
    </span>
  );
}
