  # Guide d'Intégration Rapide - Composants de Synchronisation

## 🚀 Démarrage Rapide (5 minutes)

### Étape 1 : Importer les composants

```tsx
// Dans votre composant
import { SyncButton } from './components/SyncButton';
import { SyncStatus } from './components/SyncStatus';
import { useFeedSync } from './hooks/useFeedSync';
```

### Étape 2 : Ajouter le bouton de synchronisation

Le moyen le plus simple d'ajouter la synchronisation à votre application :

```tsx
function MyComponent() {
  return (
    <div>
      {/* Bouton simple sans label */}
      <SyncButton />
      
      {/* Ou avec label */}
      <SyncButton showLabel={true} />
    </div>
  );
}
```

**C'est tout !** Le composant gère automatiquement :
- ✅ L'état de synchronisation
- ✅ Les animations
- ✅ La progression
- ✅ Les erreurs
- ✅ L'annulation

## 📍 Emplacements Recommandés

### 1. Dans le Footer du SourcePanel (Recommandé)

```tsx
// src/components/SourcePanel.tsx
import { SyncButton } from './SyncButton';

export function SourcePanel() {
  return (
    <div className="source-panel">
      {/* ... contenu ... */}
      
      <div className="source-panel-footer">
        <SyncButton showLabel={false} />
        <button className="footer-btn">+</button>
        <button className="footer-btn">⚙</button>
      </div>
    </div>
  );
}
```

### 2. Dans le Header du FeedPanel

```tsx
// src/components/FeedPanel.tsx
import { SyncButton } from './SyncButton';
import { SyncStatus } from './SyncStatus';

export function FeedPanel() {
  return (
    <div className="feed-panel">
      <div className="feed-panel-header">
        <div className="feed-panel-title-row">
          <h2>Articles</h2>
          <div className="feed-panel-actions">
            <SyncButton />
            {/* autres boutons */}
          </div>
        </div>
        
        {/* Afficher le statut compact */}
        <SyncStatus compact={true} />
      </div>
      
      {/* ... liste des articles ... */}
    </div>
  );
}
```

### 3. Panneau de Paramètres

```tsx
function SettingsPanel() {
  return (
    <div className="settings">
      <h3>Synchronisation</h3>
      
      {/* Statut détaillé */}
      <SyncStatus />
      
      {/* Options */}
      <SyncButton showLabel={true} />
    </div>
  );
}
```

## 🎯 Cas d'Usage Avancés

### Synchronisation Automatique

```tsx
import { useEffect } from 'react';
import { useFeedSync } from './hooks/useFeedSync';

function App() {
  const { syncAll, isSyncing } = useFeedSync();
  
  useEffect(() => {
    // Synchroniser au démarrage
    syncAll();
    
    // Synchroniser toutes les 5 minutes
    const interval = setInterval(() => {
      if (!isSyncing) {
        syncAll();
      }
    }, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [syncAll, isSyncing]);
  
  return <div>...</div>;
}
```

### Synchronisation d'un Flux Spécifique

```tsx
function FeedItem({ feedId }) {
  const { syncFeed, isSyncing } = useFeedSync();
  
  const handleSync = () => {
    syncFeed(feedId);
  };
  
  return (
    <button onClick={handleSync} disabled={isSyncing}>
      Actualiser ce flux
    </button>
  );
}
```

### Afficher des Notifications

```tsx
import { useEffect } from 'react';
import { useFeedSync } from './hooks/useFeedSync';

function SyncNotifications() {
  const { syncState } = useFeedSync();
  
  useEffect(() => {
    if (syncState.status === 'success') {
      // Afficher une notification de succès
      console.log('✓ Synchronisation réussie !');
    } else if (syncState.status === 'error') {
      // Afficher une erreur
      console.error('✗ Erreur :', syncState.error);
    }
  }, [syncState.status, syncState.error]);
  
  return null;
}
```

### Interface Personnalisée

```tsx
function CustomSyncUI() {
  const { syncState, syncAll, cancelSync, isSyncing } = useFeedSync();
  
  return (
    <div className="custom-sync">
      {/* Bouton personnalisé */}
      <button 
        onClick={isSyncing ? cancelSync : syncAll}
        className={`sync-btn ${syncState.status}`}
      >
        {isSyncing ? (
          <>
            <Spinner /> Synchronisation {syncState.progress}%
          </>
        ) : (
          <>
            <RefreshIcon /> Synchroniser
          </>
        )}
      </button>
      
      {/* Info */}
      {syncState.lastSyncTime && (
        <small>
          Dernière synchro : {syncState.lastSyncTime.toLocaleString()}
        </small>
      )}
      
      {/* Erreur */}
      {syncState.error && (
        <div className="error">{syncState.error}</div>
      )}
    </div>
  );
}
```

## 🔧 Intégration avec une API Réelle

Actuellement, le hook utilise des données simulées. Voici comment intégrer avec votre backend :

```typescript
// src/hooks/useFeedSync.ts

const syncAll = useCallback(async () => {
  try {
    abortControllerRef.current = new AbortController();
    setSyncState({ status: 'syncing', ... });

    // ⚠️ REMPLACEZ CETTE PARTIE :
    // await new Promise(resolve => setTimeout(resolve, 800));

    // ✅ PAR VOTRE APPEL API :
    const feeds = await fetchFeeds(); // Votre fonction
    
    for (let i = 0; i < feeds.length; i++) {
      const feed = feeds[i];
      
      // Fetch RSS feed
      const response = await fetch(`/api/feeds/${feed.id}/sync`, {
        method: 'POST',
        signal: abortControllerRef.current.signal,
      });
      
      if (!response.ok) throw new Error('Sync failed');
      
      // Update progress
      const progress = ((i + 1) / feeds.length) * 100;
      setSyncState(prev => ({ ...prev, progress }));
    }

    setSyncState({
      status: 'success',
      lastSyncTime: new Date(),
      error: null,
      progress: 100,
    });

  } catch (error) {
    // Handle error...
  }
}, []);
```

## 💡 Conseils et Bonnes Pratiques

### ✅ À Faire

1. **Utiliser SyncButton pour une intégration simple**
   - Parfait pour les barres d'outils et menus
   
2. **Utiliser SyncStatus pour informer l'utilisateur**
   - Idéal dans les panneaux de paramètres ou dashboards
   
3. **Utiliser useFeedSync pour une logique personnalisée**
   - Quand vous avez besoin de contrôle total

4. **Synchronisation automatique intelligente**
   ```tsx
   // Synchroniser seulement si l'utilisateur est actif
   const handleVisibilityChange = () => {
     if (document.visibilityState === 'visible' && !isSyncing) {
       syncAll();
     }
   };
   ```

5. **Gérer les erreurs réseau**
   ```tsx
   useEffect(() => {
     if (syncState.status === 'error') {
       // Retry après 30 secondes
       const timeout = setTimeout(() => syncAll(), 30000);
       return () => clearTimeout(timeout);
     }
   }, [syncState.status]);
   ```

### ❌ À Éviter

1. **Ne pas synchroniser trop souvent**
   - Respectez un intervalle minimum (ex: 2-5 minutes)
   
2. **Ne pas bloquer l'UI**
   - La synchronisation est asynchrone, l'UI reste réactive
   
3. **Ne pas ignorer les erreurs**
   - Toujours informer l'utilisateur en cas d'échec

## 🎨 Personnalisation du Style

### Modifier les Couleurs

```css
/* Dans votre CSS */
.sync-button.syncing {
  color: #your-blue !important;
}

.sync-button.success {
  color: #your-green !important;
}

.sync-button.error {
  color: #your-red !important;
}
```

### Style Personnalisé

```tsx
<SyncButton 
  style={{
    padding: '12px 24px',
    background: 'linear-gradient(45deg, #f09, #0af)',
    borderRadius: '20px',
  }}
/>
```

## 🐛 Dépannage

### Le bouton ne fait rien

**Solution :** Vérifiez que le hook est bien importé et utilisé dans le composant parent.

### La progression ne s'affiche pas

**Solution :** Le composant `SyncStatus` affiche automatiquement la progression. Assurez-vous qu'il est visible pendant la synchronisation.

### Erreur "AbortController is not defined"

**Solution :** Utilisez un polyfill pour les navigateurs plus anciens :
```bash
npm install abortcontroller-polyfill
```

### La synchronisation ne s'arrête jamais

**Solution :** Vérifiez que vos promesses se résolvent correctement et que vous n'avez pas de boucle infinie.

## 📚 Ressources

- **Fichiers créés :**
  - `src/hooks/useFeedSync.ts` - Hook de synchronisation
  - `src/components/SyncButton.tsx` - Bouton de synchronisation
  - `src/components/SyncStatus.tsx` - Affichage du statut
  - `src/components/SyncExample.tsx` - Exemples d'utilisation

- **Documentation complète :**
  - Voir `SYNC_COMPONENTS_README.md` pour l'API détaillée

## 🎯 Checklist d'Intégration

- [ ] Importer les composants nécessaires
- [ ] Ajouter `SyncButton` dans l'interface
- [ ] (Optionnel) Ajouter `SyncStatus` pour plus d'infos
- [ ] Tester la synchronisation
- [ ] Intégrer avec votre API backend
- [ ] Ajouter la synchronisation automatique si nécessaire
- [ ] Gérer les erreurs appropriément
- [ ] Tester sur mobile/tablette

## 🚀 Et Ensuite ?

1. **Intégrez les composants** dans votre application
2. **Testez** les différentes fonctionnalités
3. **Connectez** à votre API backend
4. **Personnalisez** selon vos besoins
5. **Profitez** d'une synchronisation fluide ! 🎉

---

**Besoin d'aide ?** Consultez le fichier `SyncExample.tsx` pour voir tous les cas d'usage en action.