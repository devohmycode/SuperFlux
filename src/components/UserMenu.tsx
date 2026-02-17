import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AuthModal } from './AuthModal';

export function UserMenu() {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  if (!user) {
    return (
      <>
        <button
          className="footer-btn user-menu-login-btn"
          title="Se connecter"
          onClick={() => setAuthOpen(true)}
        >
          <span>👤</span>
        </button>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
      </>
    );
  }

  const displayName = user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.email?.split('@')[0]
    || 'Utilisateur';

  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;

  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setMenuOpen(prev => !prev)}
        title={displayName}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="user-menu-avatar" />
        ) : (
          <span className="user-menu-avatar-fallback">{initial}</span>
        )}
      </button>

      {menuOpen && (
        <div className="user-menu-dropdown">
          <div className="user-menu-info">
            <span className="user-menu-name">{displayName}</span>
            <span className="user-menu-email">{user.email}</span>
          </div>
          <div className="user-menu-divider" />
          <button
            className="user-menu-item user-menu-item--danger"
            onClick={() => { signOut(); setMenuOpen(false); }}
          >
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
