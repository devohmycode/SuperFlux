import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthMode = 'login' | 'signup';

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { signInWithEmail, signUpWithEmail, signInWithOAuth, isConfigured } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
        onClose();
      } else {
        await signUpWithEmail(email, password);
        setSuccess('Vérifiez votre e-mail pour confirmer votre compte.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Une erreur est survenue';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setError(null);
    try {
      await signInWithOAuth(provider);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Une erreur est survenue';
      setError(message);
    }
  };

  const handleClose = () => {
    setError(null);
    setSuccess(null);
    setEmail('');
    setPassword('');
    setMode('login');
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
        >
          <motion.div
            className="modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="modal-header">
              <h2 className="modal-title">
                {mode === 'login' ? 'Se connecter' : 'Créer un compte'}
              </h2>
              <button className="modal-close" onClick={handleClose}>×</button>
            </div>

            {!isConfigured ? (
              <div className="auth-not-configured">
                <p className="auth-not-configured-text">
                  La synchronisation cloud n'est pas configurée.
                </p>
                <p className="auth-not-configured-hint">
                  Renseignez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> dans le fichier <code>.env</code> puis redémarrez l'application.
                </p>
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={handleClose}>
                    Fermer
                  </button>
                </div>
              </div>
            ) : (
            <form className="modal-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">E-mail</label>
                <input
                  className="form-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Mot de passe</label>
                <input
                  className="form-input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <motion.div
                  className="form-error"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {error}
                </motion.div>
              )}

              {success && (
                <motion.div
                  className="auth-success"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {success}
                </motion.div>
              )}

              <div className="modal-actions">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading}
                  style={{ flex: 1 }}
                >
                  {loading
                    ? '...'
                    : mode === 'login'
                      ? 'Se connecter'
                      : 'Créer le compte'}
                </button>
              </div>

              <div className="auth-divider">
                <span>ou</span>
              </div>

              <div className="auth-oauth-buttons">
                <button
                  type="button"
                  className="btn-secondary auth-oauth-btn"
                  onClick={() => handleOAuth('github')}
                >
                  GitHub
                </button>
                <button
                  type="button"
                  className="btn-secondary auth-oauth-btn"
                  onClick={() => handleOAuth('google')}
                >
                  Google
                </button>
              </div>

              <div className="auth-switch">
                {mode === 'login' ? (
                  <span>
                    Pas de compte ?{' '}
                    <button type="button" className="auth-switch-link" onClick={() => { setMode('signup'); setError(null); setSuccess(null); }}>
                      Créer un compte
                    </button>
                  </span>
                ) : (
                  <span>
                    Déjà un compte ?{' '}
                    <button type="button" className="auth-switch-link" onClick={() => { setMode('login'); setError(null); setSuccess(null); }}>
                      Se connecter
                    </button>
                  </span>
                )}
              </div>
            </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
