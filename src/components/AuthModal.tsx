import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, Eye, EyeClosed, ArrowRight, Github } from 'lucide-react';
import { cn } from '../lib/utils';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthMode = 'login' | 'signup';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full min-w-0 rounded-lg border bg-transparent px-3 py-1 text-sm text-white placeholder:text-white/30 outline-none transition-all duration-300',
        'border-transparent bg-white/5 focus:border-white/20 focus:bg-white/10',
        className,
      )}
      {...props}
    />
  );
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { t } = useTranslation();
  const { signInWithEmail, signUpWithEmail, signInWithOAuth, isConfigured } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<'email' | 'password' | null>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useTransform(mouseY, [-300, 300], [10, -10]);
  const rotateY = useTransform(mouseX, [-300, 300], [-10, 10]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left - rect.width / 2);
    mouseY.set(e.clientY - rect.top - rect.height / 2);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

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
        setSuccess(t('auth.checkEmail'));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.errorOccurred');
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
      const message = err instanceof Error ? err.message : t('common.errorOccurred');
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
          className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={handleBackdropClick}
        >
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-purple-500/40 via-purple-700/50 to-black" />

          {/* Noise texture */}
          <div
            className="absolute inset-0 opacity-[0.03] mix-blend-soft-light"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
              backgroundSize: '200px 200px',
            }}
          />

          {/* Top radial glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[120vh] h-[60vh] rounded-b-[50%] bg-purple-400/20 blur-[80px]" />
          <motion.div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[100vh] h-[60vh] rounded-b-full bg-purple-300/20 blur-[60px]"
            animate={{ opacity: [0.15, 0.3, 0.15], scale: [0.98, 1.02, 0.98] }}
            transition={{ duration: 8, repeat: Infinity, repeatType: 'mirror' }}
          />
          <motion.div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[90vh] h-[90vh] rounded-t-full bg-purple-400/20 blur-[60px]"
            animate={{ opacity: [0.3, 0.5, 0.3], scale: [1, 1.1, 1] }}
            transition={{ duration: 6, repeat: Infinity, repeatType: 'mirror', delay: 1 }}
          />

          {/* Glow spots */}
          <div className="absolute left-1/4 top-1/4 w-96 h-96 bg-white/5 rounded-full blur-[100px] animate-pulse opacity-40" />
          <div className="absolute right-1/4 bottom-1/4 w-96 h-96 bg-white/5 rounded-full blur-[100px] animate-pulse delay-1000 opacity-40" />

          {/* Card container */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-sm relative z-10 px-4"
            style={{ perspective: 1500 }}
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              className="relative"
              style={{ rotateX, rotateY }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              whileHover={{ z: 10 }}
            >
              <div className="relative group">
                {/* Card glow */}
                <motion.div
                  className="absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-70 transition-opacity duration-700"
                  animate={{
                    boxShadow: [
                      '0 0 10px 2px rgba(255,255,255,0.03)',
                      '0 0 15px 5px rgba(255,255,255,0.05)',
                      '0 0 10px 2px rgba(255,255,255,0.03)',
                    ],
                    opacity: [0.2, 0.4, 0.2],
                  }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror' }}
                />

                {/* Traveling light beams */}
                <div className="absolute -inset-px rounded-2xl overflow-hidden">
                  <motion.div
                    className="absolute top-0 left-0 h-[3px] w-1/2 bg-gradient-to-r from-transparent via-white to-transparent opacity-70"
                    style={{ filter: 'blur(2px)' }}
                    animate={{ left: ['-50%', '100%'], opacity: [0.3, 0.7, 0.3] }}
                    transition={{ left: { duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1 }, opacity: { duration: 1.2, repeat: Infinity, repeatType: 'mirror' } }}
                  />
                  <motion.div
                    className="absolute top-0 right-0 h-1/2 w-[3px] bg-gradient-to-b from-transparent via-white to-transparent opacity-70"
                    style={{ filter: 'blur(2px)' }}
                    animate={{ top: ['-50%', '100%'], opacity: [0.3, 0.7, 0.3] }}
                    transition={{ top: { duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1, delay: 0.6 }, opacity: { duration: 1.2, repeat: Infinity, repeatType: 'mirror', delay: 0.6 } }}
                  />
                  <motion.div
                    className="absolute bottom-0 right-0 h-[3px] w-1/2 bg-gradient-to-r from-transparent via-white to-transparent opacity-70"
                    style={{ filter: 'blur(2px)' }}
                    animate={{ right: ['-50%', '100%'], opacity: [0.3, 0.7, 0.3] }}
                    transition={{ right: { duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1, delay: 1.2 }, opacity: { duration: 1.2, repeat: Infinity, repeatType: 'mirror', delay: 1.2 } }}
                  />
                  <motion.div
                    className="absolute bottom-0 left-0 h-1/2 w-[3px] bg-gradient-to-b from-transparent via-white to-transparent opacity-70"
                    style={{ filter: 'blur(2px)' }}
                    animate={{ bottom: ['-50%', '100%'], opacity: [0.3, 0.7, 0.3] }}
                    transition={{ bottom: { duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1, delay: 1.8 }, opacity: { duration: 1.2, repeat: Infinity, repeatType: 'mirror', delay: 1.8 } }}
                  />
                </div>

                {/* Glass card */}
                <div className="relative bg-black/40 backdrop-blur-xl rounded-2xl p-6 border border-white/[0.05] shadow-2xl overflow-hidden">
                  {/* Inner pattern */}
                  <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                      backgroundImage: 'linear-gradient(135deg, white 0.5px, transparent 0.5px), linear-gradient(45deg, white 0.5px, transparent 0.5px)',
                      backgroundSize: '30px 30px',
                    }}
                  />

                  {/* Close button */}
                  <button
                    onClick={handleClose}
                    className="absolute top-4 right-4 z-20 w-7 h-7 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all duration-200 text-lg"
                  >
                    &times;
                  </button>

                  {!isConfigured ? (
                    <div className="relative z-10 text-center space-y-4 py-4">
                      <p className="text-white/80 text-sm">{t('auth.cloudNotConfigured')}</p>
                      <p className="text-white/50 text-xs">
                        Renseignez <code className="text-white/70 bg-white/10 px-1 rounded">VITE_SUPABASE_URL</code> et <code className="text-white/70 bg-white/10 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> dans <code className="text-white/70 bg-white/10 px-1 rounded">.env</code>
                      </p>
                      <button
                        onClick={handleClose}
                        className="mt-2 px-4 py-2 rounded-lg bg-white/10 text-white/80 text-sm hover:bg-white/20 transition-colors"
                      >
                        {t('common.close')}
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Header */}
                      <div className="relative z-10 text-center space-y-1 mb-5">
                        <motion.div
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', duration: 0.8 }}
                          className="mx-auto w-10 h-10 rounded-full border border-white/10 flex items-center justify-center relative overflow-hidden"
                        >
                          <span className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/70">S</span>
                          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
                        </motion.div>

                        <motion.h1
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2 }}
                          className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/80"
                        >
                          {mode === 'login' ? t('auth.welcomeBack') : t('auth.createAccount')}
                        </motion.h1>

                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.3 }}
                          className="text-white/60 text-xs"
                        >
                          {mode === 'login' ? t('auth.connectToContinue') : t('auth.signUpToStart')}
                        </motion.p>
                      </div>

                      {/* Form */}
                      <form onSubmit={handleSubmit} className="relative z-10 space-y-4">
                        <motion.div className="space-y-3">
                          {/* Email */}
                          <motion.div
                            className={cn('relative', focusedInput === 'email' && 'z-10')}
                            whileHover={{ scale: 1.01 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                          >
                            <div className="relative flex items-center overflow-hidden rounded-lg">
                              <Mail className={cn('absolute left-3 w-4 h-4 transition-all duration-300', focusedInput === 'email' ? 'text-white' : 'text-white/40')} />
                              <Input
                                type="email"
                                placeholder={t('auth.emailPlaceholder')}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onFocus={() => setFocusedInput('email')}
                                onBlur={() => setFocusedInput(null)}
                                className="pl-10 pr-3"
                                required
                                autoFocus
                              />
                              {focusedInput === 'email' && (
                                <motion.div
                                  layoutId="input-highlight"
                                  className="absolute inset-0 bg-white/5 -z-10"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                />
                              )}
                            </div>
                          </motion.div>

                          {/* Password */}
                          <motion.div
                            className={cn('relative', focusedInput === 'password' && 'z-10')}
                            whileHover={{ scale: 1.01 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                          >
                            <div className="relative flex items-center overflow-hidden rounded-lg">
                              <Lock className={cn('absolute left-3 w-4 h-4 transition-all duration-300', focusedInput === 'password' ? 'text-white' : 'text-white/40')} />
                              <Input
                                type={showPassword ? 'text' : 'password'}
                                placeholder={t('auth.passwordPlaceholder')}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onFocus={() => setFocusedInput('password')}
                                onBlur={() => setFocusedInput(null)}
                                className="pl-10 pr-10"
                                required
                                minLength={6}
                              />
                              <div onClick={() => setShowPassword(!showPassword)} className="absolute right-3 cursor-pointer">
                                {showPassword ? (
                                  <Eye className="w-4 h-4 text-white/40 hover:text-white transition-colors duration-300" />
                                ) : (
                                  <EyeClosed className="w-4 h-4 text-white/40 hover:text-white transition-colors duration-300" />
                                )}
                              </div>
                              {focusedInput === 'password' && (
                                <motion.div
                                  layoutId="input-highlight"
                                  className="absolute inset-0 bg-white/5 -z-10"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                />
                              )}
                            </div>
                          </motion.div>
                        </motion.div>

                        {/* Error */}
                        {error && (
                          <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-red-400 text-xs text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
                          >
                            {error}
                          </motion.div>
                        )}

                        {/* Success */}
                        {success && (
                          <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-green-400 text-xs text-center bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2"
                          >
                            {success}
                          </motion.div>
                        )}

                        {/* Submit button */}
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          type="submit"
                          disabled={loading}
                          className="w-full relative group/button mt-5"
                        >
                          <div className="absolute inset-0 bg-white/10 rounded-lg blur-lg opacity-0 group-hover/button:opacity-70 transition-opacity duration-300" />
                          <div className="relative overflow-hidden bg-white text-black font-medium h-10 rounded-lg transition-all duration-300 flex items-center justify-center">
                            <motion.div
                              className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 -z-10"
                              animate={{ x: ['-100%', '100%'] }}
                              transition={{ duration: 1.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1 }}
                              style={{ opacity: loading ? 1 : 0, transition: 'opacity 0.3s ease' }}
                            />
                            <AnimatePresence mode="wait">
                              {loading ? (
                                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-center">
                                  <div className="w-4 h-4 border-2 border-black/70 border-t-transparent rounded-full animate-spin" />
                                </motion.div>
                              ) : (
                                <motion.span key="text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-center gap-1 text-sm font-medium">
                                  {mode === 'login' ? t('auth.signIn') : t('auth.createTheAccount')}
                                  <ArrowRight className="w-3 h-3 group-hover/button:translate-x-1 transition-transform duration-300" />
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </div>
                        </motion.button>

                        {/* Divider */}
                        <div className="relative mt-2 mb-5 flex items-center">
                          <div className="flex-grow border-t border-white/5" />
                          <motion.span
                            className="mx-3 text-xs text-white/40"
                            animate={{ opacity: [0.7, 0.9, 0.7] }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                          >
                            {t('common.or')}
                          </motion.span>
                          <div className="flex-grow border-t border-white/5" />
                        </div>

                        {/* OAuth buttons */}
                        <div className="space-y-2">
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            type="button"
                            onClick={() => handleOAuth('google')}
                            className="w-full relative group/google"
                          >
                            <div className="absolute inset-0 bg-white/5 rounded-lg blur opacity-0 group-hover/google:opacity-70 transition-opacity duration-300" />
                            <div className="relative overflow-hidden bg-white/5 text-white font-medium h-10 rounded-lg border border-white/10 hover:border-white/20 transition-all duration-300 flex items-center justify-center gap-2">
                              <svg className="w-4 h-4" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                              </svg>
                              <span className="text-white/80 group-hover/google:text-white transition-colors text-xs">Google</span>
                            </div>
                          </motion.button>

                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            type="button"
                            onClick={() => handleOAuth('github')}
                            className="w-full relative group/github"
                          >
                            <div className="absolute inset-0 bg-white/5 rounded-lg blur opacity-0 group-hover/github:opacity-70 transition-opacity duration-300" />
                            <div className="relative overflow-hidden bg-white/5 text-white font-medium h-10 rounded-lg border border-white/10 hover:border-white/20 transition-all duration-300 flex items-center justify-center gap-2">
                              <Github className="w-4 h-4 text-white/80 group-hover/github:text-white transition-colors" />
                              <span className="text-white/80 group-hover/github:text-white transition-colors text-xs">GitHub</span>
                            </div>
                          </motion.button>
                        </div>

                        {/* Switch mode */}
                        <motion.p
                          className="text-center text-xs text-white/60 mt-4"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.5 }}
                        >
                          {mode === 'login' ? (
                            <>
                              {t('auth.noAccount')}{' '}
                              <button
                                type="button"
                                onClick={() => { setMode('signup'); setError(null); setSuccess(null); }}
                                className="relative inline-block group/switch"
                              >
                                <span className="relative z-10 text-white group-hover/switch:text-white/70 transition-colors duration-300 font-medium">
                                  {t('auth.createAccount')}
                                </span>
                                <span className="absolute bottom-0 left-0 w-0 h-px bg-white group-hover/switch:w-full transition-all duration-300" />
                              </button>
                            </>
                          ) : (
                            <>
                              {t('auth.alreadyHaveAccount')}{' '}
                              <button
                                type="button"
                                onClick={() => { setMode('login'); setError(null); setSuccess(null); }}
                                className="relative inline-block group/switch"
                              >
                                <span className="relative z-10 text-white group-hover/switch:text-white/70 transition-colors duration-300 font-medium">
                                  {t('auth.signIn')}
                                </span>
                                <span className="absolute bottom-0 left-0 w-0 h-px bg-white group-hover/switch:w-full transition-all duration-300" />
                              </button>
                            </>
                          )}
                        </motion.p>
                      </form>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
