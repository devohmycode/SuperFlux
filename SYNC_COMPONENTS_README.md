# Composants de Synchronisation RSS

Ce document décrit les composants de synchronisation créés pour l'application RSS React.

## 📋 Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Composants](#composants)
  - [SyncButton](#syncbutton)
  - [SyncStatus](#syncstatus)
- [Hook](#hook)
  - [useFeedSync](#usefeedsync)
- [Exemples d'utilisation](#exemples-dutilisation)
- [API](#api)

## Vue d'ensemble

Le système de synchronisation permet de rafraîchir les flux RSS et d'afficher l'état de la synchronisation à l'utilisateur. Il comprend :

- **useFeedSync** : Hook personnalisé gérant la logique de synchronisation
- **SyncButton** : Bouton interactif pour déclencher la synchronisation
- **SyncStatus** : Composant d'affichage de l'état de synchronisation

## Composants

### SyncButton

Bouton animé avec indicateur de progression pour déclencher la synchronisation.

#### Props

```typescript
interface SyncButtonProps {
  className?: string;        // Classes CSS additionnelles
  style?: CSSProperties;     // Styles inline personnalisés
  showLabel?: boolean;       // Afficher le label texte (défaut: false)
}
```

#### Fonctionnalités

- ✅ Icône animée pendant la synchronisation
- ✅ Indicateur de progression visuel
- ✅ États visuels (idle, syncing, success, error)
- ✅ Animation au survol et au clic
- ✅ Info-bulle avec dernière synchronisation
- ✅ Possibilité d'annuler la synchronisation

#### Exemple

```tsx
import { SyncButton } from './components/SyncButton';

// Utilisation simple
<SyncButton />

// Avec label
<SyncButton showLabel={true} />

// Avec style personnalisé
<SyncButton 
  showLabel={true}
  className="my-custom-class"
  style={{ marginLeft: 'auto' }}
/>
```

### SyncStatus

Composant d'affichage détaillé de l'état de synchronisation.

#### Props

```typescript
interface SyncStatusProps {
  className?: string;        // Classes CSS additionnelles
  style?: CSSProperties;     // Styles inline personnalisés
  compact?: boolean;         // Mode compact (défaut: false)
}
```

#### Fonctionnalités

- ✅ Affichage de l'état actuel (idle, syncing, success, error)
- ✅ Barre de progression animée
- ✅ Affichage de la dernière synchronisation
- ✅ Messages d'erreur détaillés
- ✅ Mode compact pour intégration dans l'UI

#### Exemple

```tsx
import { SyncStatus } from './components/SyncStatus';

// Affichage complet
<SyncStatus />

// Mode compact
<SyncStatus compact={true} />

// Avec style personnalisé
<SyncStatus 
  compact={true}
  style={{ padding: '8px' }}
/>
```

## Hook

### useFeedSync

Hook personnalisé gérant la logique de synchronisation des flux RSS.

#### Retour

```typescript
interface UseFeedSyncReturn {
  syncState: SyncState;              // État actuel de la synchronisation
  syncAll: () => Promise<void>;      // Synchroniser tous les flux
  syncFeed: (feedId: string) => Promise<void>;  // Synchroniser un flux spécifique
  cancelSync: () => void;            // Annuler la synchronisation en cours
  isSyncing: boolean;                // Indicateur de synchronisation active
}

interface SyncState {
  status: 'idle' | 'syncing' | 'success' | 'error';
  lastSyncTime: Date | null;
  error: string | null;
  progress: number;  // 0-100
}
```

#### Exemple

```tsx
import { useFeedSync } from './hooks/useFeedSync';

function MyComponent() {
  const { syncState, syncAll, syncFeed, cancelSync, isSyncing } = useFeedSync();

  const handleSyncAll = async () => {
    await syncAll();
  };

  const handleSyncOne = async (feedId: string) => {
    await syncFeed(feedId);
  };

  return (
    <div>
      <button onClick={handleSyncAll} disabled={isSyncing}>
        {isSyncing ? 'Synchronisation...' : 'Synchroniser'}
      </button>
      
      {syncState.status === 'error' && (
        <p>Erreur : {syncState.error}</p>
      )}
      
      {syncState.lastSyncTime && (
        <p>Dernière synchro : {syncState.lastSyncTime.toLocaleString()}</p>
      )}
    </div>
  );
}
```

## Exemples d'utilisation

### Intégration dans le SourcePanel (Footer)

```tsx
// src/components/SourcePanel.tsx
import { SyncButton } from './SyncButton';

export function SourcePanel() {
  return (
    <div className="source-panel">
      {/* ... contenu du panel ... */}
      
      <div className="source-panel-footer">
        <SyncButton showLabel={false} />
        <button className="footer-btn" title="Paramètres">⚙️</button>
        {/* ... autres boutons ... */}
      </div>
    </div>
  );
}
```

### Intégration dans le FeedPanel (Header)

```tsx
// src/components/FeedPanel.tsx
import { SyncButton } from './SyncButton';
import { SyncStatus } from './SyncStatus';

export function FeedPanel() {
  return (
    <div className="feed-panel">
      <div className="feed-panel-header">
        <div className="feed-panel-title-row">
          <h2 className="feed-panel-title">Tous les articles</h2>
          <span className="feed-panel-unread">48 non lus</span>
        </div>
        
        <div className="feed-panel-actions">
          <SyncButton showLabel={false} />
          {/* ... autres actions ... */}
        </div>
        
        <SyncStatus compact={true} />
      </div>
      
      {/* ... liste des articles ... */}
    </div>
  );
}
```

### Utilisation personnalisée avec le hook

```tsx
import { useFeedSync } from './hooks/useFeedSync';

export function CustomSyncComponent() {
  const { syncState, syncAll, isSyncing } = useFeedSync();

  return (
    <div className="custom-sync">
      <h3>Synchronisation</h3>
      
      <button onClick={syncAll} disabled={isSyncing}>
        Synchroniser maintenant
      </button>
      
      {/* Barre de progression personnalisée */}
      {isSyncing && (
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ width: `${syncState.progress}%` }}
          />
        </div>
      )}
      
      {/* Statut */}
      <div className={`status status-${syncState.status}`}>
        {syncState.status === 'success' && '✓ Synchronisé'}
        {syncState.status === 'error' && `✗ ${syncState.error}`}
        {syncState.status === 'syncing' && `⟳ ${syncState.progress}%`}
      </div>
      
      {/* Dernière synchronisation */}
      {syncState.lastSyncTime && (
        <small>
          Dernière synchro : {syncState.lastSyncTime.toLocaleTimeString()}
        </small>
      )}
    </div>
  );
}
```

### Synchronisation automatique

```tsx
import { useEffect } from 'react';
import { useFeedSync } from './hooks/useFeedSync';

export function AutoSyncComponent() {
  const { syncAll, isSyncing } = useFeedSync();

  // Synchronisation automatique toutes les 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isSyncing) {
        syncAll();
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [syncAll, isSyncing]);

  return null; // Composant invisible
}
```

## API

### États de synchronisation

- **idle** : Aucune synchronisation en cours
- **syncing** : Synchronisation en cours
- **success** : Synchronisation réussie
- **error** : Erreur lors de la synchronisation

### Progression

La progression est un nombre de 0 à 100 représentant le pourcentage de flux synchronisés.

### Gestion des erreurs

Les erreurs sont capturées et stockées dans `syncState.error`. Le composant affiche automatiquement l'état d'erreur et revient à l'état `idle` après 3 secondes.

### Annulation

La synchronisation peut être annulée à tout moment en cliquant sur le bouton pendant qu'elle est active, ou en appelant `cancelSync()`.

## 🎨 Personnalisation

Les composants utilisent les variables CSS définies dans `index.css` :

```css
--accent: #D4A853;
--green: #4AE88A;
--red: #E85D4A;
--blue: #4A8EE8;
```

Vous pouvez personnaliser l'apparence en :
- Ajoutant des classes CSS personnalisées via la prop `className`
- Utilisant des styles inline via la prop `style`
- Modifiant les variables CSS dans `:root`

## 🔄 Intégration avec une vraie API

Actuellement, le hook utilise des données simulées. Pour intégrer avec une vraie API RSS :

```typescript
// Dans useFeedSync.ts, remplacez les setTimeout par de vrais appels API

const syncAll = useCallback(async () => {
  try {
    abortControllerRef.current = new AbortController();
    setSyncState({ status: 'syncing', ... });

    // Remplacez ceci :
    // await new Promise(resolve => setTimeout(resolve, 800));

    // Par un vrai appel API :
    const response = await fetch('/api/feeds/sync', {
      method: 'POST',
      signal: abortControllerRef.current.signal,
    });
    
    const data = await response.json();
    
    // Mettez à jour l'état avec les vraies données
    setSyncState({
      status: 'success',
      lastSyncTime: new Date(),
      error: null,
      progress: 100,
    });
  } catch (error) {
    // Gestion des erreurs...
  }
}, []);
```

## 📝 Notes

- Les composants sont entièrement typés avec TypeScript
- Les animations utilisent la bibliothèque `motion` (Framer Motion)
- Les composants sont accessibles et réactifs
- Le hook gère automatiquement le nettoyage des ressources
- Les erreurs de réseau sont gérées automatiquement

---

**Auteur** : Composants créés pour l'application RSS React  
**Version** : 1.0.0  
**Date** : 2024