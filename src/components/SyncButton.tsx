import { motion } from 'motion/react';
import type { CSSProperties } from 'react';

interface SyncButtonProps {
  className?: string;
  style?: CSSProperties;
  showLabel?: boolean;
  onSync?: () => void;
  isSyncing?: boolean;
  progress?: number;
}

export function SyncButton({ 
  className = '', 
  style, 
  showLabel = false,
  onSync,
  isSyncing = false,
  progress = 0,
}: SyncButtonProps) {
  const handleClick = () => {
    if (!isSyncing && onSync) {
      onSync();
    }
  };

  const getStatusColor = () => {
    if (isSyncing) return '#3b82f6'; // blue
    return '#6b7280'; // gray
  };

  const getButtonTitle = () => {
    if (isSyncing) return `Synchronisation... ${Math.round(progress)}%`;
    return 'Synchroniser les flux';
  };

  return (
    <div className={`sync-button-container ${className}`} style={style}>
      <motion.button
        className={`sync-button ${isSyncing ? 'syncing' : ''}`}
        onClick={handleClick}
        title={getButtonTitle()}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        disabled={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: showLabel ? '8px 16px' : '6px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: getStatusColor(),
          cursor: isSyncing ? 'pointer' : 'pointer',
          fontSize: '14px',
          fontWeight: 500,
          transition: 'background-color 0.2s',
        }}
      >
        <motion.svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          animate={{
            rotate: isSyncing ? 360 : 0,
          }}
          transition={{
            duration: 1,
            repeat: isSyncing ? Infinity : 0,
            ease: 'linear',
          }}
        >
          <>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </>
        </motion.svg>

        {showLabel && (
          <span>
            {isSyncing ? 'Syncing...' : 'Sync'}
          </span>
        )}
      </motion.button>

      {isSyncing && progress > 0 && (
        <motion.div
          className="sync-progress"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: '2px',
            backgroundColor: getStatusColor(),
            borderRadius: '1px',
          }}
        />
      )}
    </div>
  );
}
