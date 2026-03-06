import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { usePro } from '../contexts/ProContext';
import { useAuth } from '../contexts/AuthContext';
import { LEMONSQUEEZY_CHECKOUT_URL, LEMONSQUEEZY_SUBSCRIPTION_URL } from '../services/licenseService';
import { openExternal } from '../lib/tauriFetch';

export function UpgradeModal() {
  const { t } = useTranslation();
  const { upgradeModalOpen, hideUpgradeModal, activateLicense } = usePro();
  const { user } = useAuth();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setError(null);
    setLoading(true);
    try {
      const result = await activateLicense(key.trim());
      if (result.success) {
        setKey('');
        hideUpgradeModal();
      } else {
        setError(result.error || t('upgrade.activationFailed'));
      }
    } catch {
      setError(t('upgrade.unexpectedError'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setKey('');
    setError(null);
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
              <h2 className="modal-title">{t('upgrade.title')}</h2>
              <button className="modal-close" onClick={handleClose}>×</button>
            </div>

            <div className="settings-body">
              <div className="settings-section">
                <p className="settings-section-desc">
                  {t('upgrade.description')}
                </p>
                <ul style={{ margin: '12px 0', paddingLeft: 20, lineHeight: 1.8 }}>
                  <li>{t('upgrade.moreThan10Feeds')}</li>
                  <li>{t('upgrade.moreThan5Folders')}</li>
                  <li>{t('upgrade.unlimitedAI')}</li>
                  <li>{t('upgrade.highlightsNotes')}</li>
                  <li>{t('upgrade.superEditor')}</li>
                  <li>{t('upgrade.superDraw')}</li>
                  <li>{t('upgrade.superPassword')}</li>
                  <li>{t('upgrade.superMarkdown')}</li>
                  <li>{t('upgrade.earlyAccess')}</li>
                </ul>

                <button
                  className="btn-primary"
                  style={{ width: '100%', marginBottom: 10, position: 'relative' }}
                  onClick={() => openExternal(LEMONSQUEEZY_CHECKOUT_URL)}
                >
                  <span>{t('upgrade.buyLicense')}</span>
                </button>

                <button
                  className="btn-secondary"
                  style={{ width: '100%', marginBottom: 16 }}
                  onClick={() => openExternal(LEMONSQUEEZY_SUBSCRIPTION_URL)}
                >
                  {t('upgrade.subscription')}
                </button>
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">{t('upgrade.activateLicense')}</h3>
                <p className="settings-section-desc" style={{ marginBottom: 12, color: '#ef4444' }}>
                  {t('upgrade.mustBeLoggedIn')}
                </p>

                {!user ? (
                  <p className="settings-section-desc" style={{ opacity: 0.7, fontStyle: 'italic' }}>
                    {t('auth.loginFromSettings')}
                  </p>
                ) : (
                  <form onSubmit={handleActivate}>
                    <input
                      type="text"
                      className="provider-input"
                      placeholder={t('upgrade.pasteKey')}
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
                          {t('common.verification')}
                        </>
                      ) : (
                        t('upgrade.activate')
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={handleClose}>
                {t('common.close')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
