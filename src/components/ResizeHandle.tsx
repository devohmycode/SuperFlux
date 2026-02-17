import { useState } from 'react';

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
}

export function ResizeHandle({ onMouseDown }: ResizeHandleProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`resize-handle ${isHovered ? 'hovered' : ''}`}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="resize-handle-line" />
    </div>
  );
}
