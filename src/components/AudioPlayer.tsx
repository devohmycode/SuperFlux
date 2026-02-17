import { useState, useRef, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  src: string;
  title: string;
  feedName: string;
  duration?: number;
  thumbnail?: string;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2];

export function AudioPlayer({ src, title, feedName, duration: initialDuration, thumbnail }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [volume, setVolume] = useState(1);
  const [speedIndex, setSpeedIndex] = useState(1); // index into SPEED_OPTIONS, default 1x
  const [isLoading, setIsLoading] = useState(false);

  const speed = SPEED_OPTIONS[speedIndex];

  // Sync audio element state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
    };
    const onEnded = () => setIsPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const handleSkip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + seconds, duration || Infinity));
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const handleSpeedChange = useCallback(() => {
    const nextIndex = (speedIndex + 1) % SPEED_OPTIONS.length;
    setSpeedIndex(nextIndex);
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEED_OPTIONS[nextIndex];
    }
  }, [speedIndex]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
    }
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="audio-player">
      <audio ref={audioRef} src={src} preload="metadata" />

      {thumbnail && (
        <img className="audio-player-artwork" src={thumbnail} alt={title} />
      )}

      <div className="audio-player-body">
        <div className="audio-player-info">
          <span className="audio-player-feed">{feedName}</span>
          <span className="audio-player-title">{title}</span>
        </div>

        <div className="audio-player-controls">
          <button
            className="audio-player-btn"
            onClick={() => handleSkip(-15)}
            title="Reculer 15s"
          >
            -15
          </button>

          <button
            className="audio-player-btn audio-player-btn-play"
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Lecture'}
          >
            {isLoading ? '⟳' : isPlaying ? '⏸' : '▶'}
          </button>

          <button
            className="audio-player-btn"
            onClick={() => handleSkip(15)}
            title="Avancer 15s"
          >
            +15
          </button>

          <button
            className="audio-player-speed"
            onClick={handleSpeedChange}
            title="Vitesse de lecture"
          >
            {speed}x
          </button>
        </div>

        <div className="audio-player-progress" onClick={handleSeek}>
          <div
            className="audio-player-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="audio-player-time">
          <span>{formatDuration(currentTime)}</span>
          <input
            type="range"
            className="audio-player-volume"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            title="Volume"
          />
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
    </div>
  );
}
