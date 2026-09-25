import { JerseySize } from '../catalog/catalog.types.js';

export type WhatsAppAction =
  | { type: 'view'; jerseyId: string }
  | { type: 'sizes'; jerseyId: string }
  | { type: 'buy'; jerseyId: string; size: JerseySize }
  | { type: 'team'; team: string }
  | { type: 'support_human' };

export const whatsappActions = {
  buildView(jerseyId: string): string {
    return `view:${jerseyId}`;
  },

  buildSizes(jerseyId: string): string {
    return `sizes:${jerseyId}`;
  },

  buildBuy(jerseyId: string, size: JerseySize): string {
    return `buy:${jerseyId}:${size}`;
  },

  buildTeam(team: string): string {
    return `team:${encodeURIComponent(team.trim())}`;
  },

  buildSupportHuman(): string {
    return 'support:human';
  },

  parse(rawId: string): WhatsAppAction | null {
    if (!rawId || typeof rawId !== 'string') return null;
    const parts = rawId.split(':');
    const prefix = parts[0];

    switch (prefix) {
      case 'view':
        if (parts[1]) return { type: 'view', jerseyId: parts[1] };
        break;
      case 'sizes':
        if (parts[1]) return { type: 'sizes', jerseyId: parts[1] };
        break;
      case 'buy':
        if (parts[1] && parts[2]) {
          const validSizes: JerseySize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
          const size = parts[2].toUpperCase() as JerseySize;
          if (validSizes.includes(size)) {
            return { type: 'buy', jerseyId: parts[1], size };
          }
        }
        break;
      case 'team':
        if (parts[1]) {
          try {
            return { type: 'team', team: decodeURIComponent(parts[1]) };
          } catch {
            return { type: 'team', team: parts[1] };
          }
        }
        break;
      case 'support':
        if (parts[1] === 'human') return { type: 'support_human' };
        break;
    }
    return null;
  }
};
