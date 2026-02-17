import type { ProviderConfig, RSSProvider } from './types';
import { MinifluxProvider } from './miniflux';
import { GoogleReaderProvider } from './googleReader';
import { FeedbinProvider } from './feedbin';

export type { ProviderConfig, ProviderType, ProviderFeed, ProviderEntry, RSSProvider } from './types';

export function createProvider(config: ProviderConfig): RSSProvider {
  switch (config.type) {
    case 'miniflux':
      return new MinifluxProvider(config);
    case 'freshrss':
    case 'bazqux':
      return new GoogleReaderProvider(config);
    case 'feedbin':
      return new FeedbinProvider(config);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}
