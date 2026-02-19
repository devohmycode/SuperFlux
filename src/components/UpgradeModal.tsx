import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { usePro } from '../contexts/ProContext';
import { useAuth } from '../contexts/AuthContext';
import { LEMONSQUEEZY_CHECKOUT_URL } from '../services/licenseService';
import { openExternal } from '../lib/tauriFetch';

export function UpgradeModal() {
  const { upgradeModalOpen, hideUpgradeModal, activateLicense } = usePro();
  const { user } = useAuth();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authPrompt, setAuthPrompt] = useState(false);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    if (!user) {
      setAuthPrompt(true);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const result = await activateLicense(key.trim());
      if (result.success) {
        setKey('');
        hideUpgradeModal();
      } else {
        setError(result.error || 'Activation échouée');
      }
    } catch {
      setError('Erreur inattendue');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setKey('');
    setError(null);
    setAuthPrompt(false);
    hideUpgradeModal();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  return (
    <AnimatePresence>
      {upgradeModalOpen && (
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
              <h2 className="modal-title">Superflux Pro</h2>
              <button className="modal-close" onClick={handleClose}>×</button>
            </div>

            <div className="settings-body">
              <div className="settings-section">
                <p className="settings-section-desc">
                  Débloquez tout le potentiel de Superflux avec une licence Pro :
                </p>
                <ul style={{ margin: '12px 0', paddingLeft: 20, lineHeight: 1.8 }}>
                  <li>Résumés IA illimités</li>
                  <li>Surlignage et notes sur les articles</li>
                  <li>Plus de 50 flux RSS</li>
                  <li>Plus de 10 dossiers</li>
                  <li>Accès anticipé aux nouvelles fonctionnalités</li>
                </ul>

                <button
                  className="btn-primary"
                  style={{ width: '100%', marginBottom: 16 }}
                  onClick={() => openExternal(LEMONSQUEEZY_CHECKOUT_URL)}
                >
                  Acheter une licence Pro — 4,99 €
                </button>
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">Activer une licence</h3>

                {authPrompt && !user ? (
                  <div style={{ marginBottom: 12 }}>
                    <p className="settings-section-desc">
                      Connectez-vous à votre compte Superflux pour activer votre licence Pro.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleActivate}>
                    <input
                      type="text"
                      className="provider-input"
                      placeholder="Collez votre clé de licence..."
                      value={key}
                      onChange={(e) => { setKey(e.target.value); setError(null); }}
                      style={{ marginBottom: 8 }}
                    />
                    {error && (
                      <motion.div
                        className="form-error"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        {error}
                      </motion.div>
                    )}
                    <button
                      type="submit"
                      className="btn-primary"
                      style={{ width: '100%' }}
                      disabled={loading || !key.trim()}
                    >
                      {loading ? (
                        <>
                          <span className="btn-spinner" />
                          Vérification...
                        </>
                      ) : (
                        'Activer'
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={handleClose}>
                Fermer
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
