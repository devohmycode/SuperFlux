/**
 * Service de notifications pour les nouveaux articles
 * Utilise le plugin Tauri Notification pour des notifications natives
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { FeedItem } from '../types';

// Cache de la permission
let permissionGranted = false;

const NOTIF_KEY = 'superflux_notifications_enabled';

/** Check if notifications are globally enabled in settings */
function isGloballyEnabled(): boolean {
  try { return localStorage.getItem(NOTIF_KEY) !== 'false'; }
  catch { return true; }
}

/**
 * Demande la permission d'afficher des notifications
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    permissionGranted = await isPermissionGranted();
    
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === 'granted';
    }
    
    console.log('[notifications] Permission:', permissionGranted ? 'granted' : 'denied');
    return permissionGranted;
  } catch (e) {
    console.error('[notifications] Erreur permission:', e);
    return false;
  }
}

/**
 * Vérifie si les notifications sont autorisées
 */
export async function checkNotificationPermission(): Promise<boolean> {
  try {
    permissionGranted = await isPermissionGranted();
    return permissionGranted;
  } catch {
    return false;
  }
}

/**
 * Affiche une notification pour un nouvel article
 */
export async function notifyNewArticle(item: FeedItem, feedName: string): Promise<void> {
  if (!isGloballyEnabled()) return;

  if (!permissionGranted) {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) return;
  }

  try {
    sendNotification({
      title: feedName,
      body: item.title,
    });
  } catch (e) {
    console.error('[notifications] Erreur:', e);
  }
}

/**
 * Affiche une notification groupée pour plusieurs nouveaux articles
 */
export async function notifyNewArticles(items: FeedItem[], feedName: string): Promise<void> {
  if (!isGloballyEnabled()) return;

  if (!permissionGranted) {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) return;
  }

  if (items.length === 0) return;

  try {
    if (items.length === 1) {
      // Notification individuelle
      sendNotification({
        title: feedName,
        body: items[0].title,
      });
    } else {
      // Notification groupée
      sendNotification({
        title: feedName,
        body: `${items.length} nouveaux articles`,
      });
    }
  } catch (e) {
    console.error('[notifications] Erreur batch:', e);
  }
}
