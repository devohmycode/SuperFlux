import type { ReactNode, ButtonHTMLAttributes } from 'react';

const gradientMapping: Record<string, string> = {
  blue: 'linear-gradient(hsl(223, 90%, 50%), hsl(208, 90%, 50%))',
  purple: 'linear-gradient(hsl(283, 90%, 50%), hsl(268, 90%, 50%))',
  red: 'linear-gradient(hsl(3, 90%, 50%), hsl(348, 90%, 50%))',
  indigo: 'linear-gradient(hsl(253, 90%, 50%), hsl(238, 90%, 50%))',
  orange: 'linear-gradient(hsl(43, 90%, 50%), hsl(28, 90%, 50%))',
  green: 'linear-gradient(hsl(123, 90%, 40%), hsl(108, 90%, 40%))',
};

interface GlassIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  color: string;
  icon: ReactNode;
  active?: boolean;
}

export default function GlassIconButton({ color, icon, active, className, ...props }: GlassIconButtonProps) {
  const bg = gradientMapping[color] || color;

  return (
    <button
      type="button"
      {...props}
      className={`glass-icon-btn group ${active ? 'active' : ''} ${className || ''}`}
    >
      {/* Colored background — tilted */}
      <span className="glass-icon-bg" style={{ background: bg }} />
      {/* Frosted glass overlay */}
      <span className="glass-icon-front">
        <span className="glass-icon-inner" aria-hidden="true">
          {icon}
        </span>
      </span>
    </button>
  );
}
