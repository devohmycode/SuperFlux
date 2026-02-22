const STORAGE_KEY = 'superflux_rsshub_instance';
const DEFAULT_INSTANCE = 'https://rsshub.app';

export function getRSSHubInstance(): string {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_INSTANCE;
}

export function setRSSHubInstance(url: string) {
  const trimmed = url.trim().replace(/\/+$/, '');
  localStorage.setItem(STORAGE_KEY, trimmed || DEFAULT_INSTANCE);
}

interface RSSHubRoute {
  pattern: RegExp;
  route: (match: RegExpMatchArray) => string;
  label: (match: RegExpMatchArray) => string;
}

const routes: RSSHubRoute[] = [
  // GitHub - user repos
  {
    pattern: /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/?$/,
    route: (m) => `/github/repos/${m[1]}`,
    label: (m) => `GitHub repos de ${m[1]}`,
  },
  // GitHub - specific repo (releases)
  {
    pattern: /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/,
    route: (m) => `/github/repos/${m[1]}/${m[2]}`,
    label: (m) => `GitHub ${m[1]}/${m[2]}`,
  },
  // Instagram - user
  {
    pattern: /^https?:\/\/(www\.)?instagram\.com\/([A-Za-z0-9_.-]+)\/?$/,
    route: (m) => `/instagram/user/${m[2]}`,
    label: (m) => `Instagram @${m[2]}`,
  },
  // Telegram - channel
  {
    pattern: /^https?:\/\/(t\.me|telegram\.me)\/([A-Za-z0-9_]+)\/?$/,
    route: (m) => `/telegram/channel/${m[2]}`,
    label: (m) => `Telegram ${m[2]}`,
  },
  // Twitter/X - user
  {
    pattern: /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/?$/,
    route: (m) => `/twitter/user/${m[3]}`,
    label: (m) => `Twitter @${m[3]}`,
  },
  // Bilibili - user videos
  {
    pattern: /^https?:\/\/space\.bilibili\.com\/(\d+)\/?/,
    route: (m) => `/bilibili/user/video/${m[1]}`,
    label: (m) => `Bilibili ${m[1]}`,
  },
  // Zhihu - people activities
  {
    pattern: /^https?:\/\/(www\.)?zhihu\.com\/people\/([A-Za-z0-9_-]+)\/?/,
    route: (m) => `/zhihu/people/${m[2]}/activities`,
    label: (m) => `Zhihu ${m[2]}`,
  },
  // Weibo - user
  {
    pattern: /^https?:\/\/(www\.)?weibo\.com\/(u\/)?(\d+)\/?/,
    route: (m) => `/weibo/user/${m[3]}`,
    label: (m) => `Weibo ${m[3]}`,
  },
  // Douban - movie/book
  {
    pattern: /^https?:\/\/(www\.)?douban\.com\/(game|movie|book|music)\/subject\/(\d+)\/?/,
    route: (m) => `/douban/${m[2]}/${m[3]}/comments`,
    label: (m) => `Douban ${m[2]} ${m[3]}`,
  },
  // Pinterest - user
  {
    pattern: /^https?:\/\/(www\.)?pinterest\.(com|fr|co\.uk)\/([A-Za-z0-9_.-]+)\/?$/,
    route: (m) => `/pinterest/user/${m[3]}`,
    label: (m) => `Pinterest ${m[3]}`,
  },
  // Pixiv - user
  {
    pattern: /^https?:\/\/(www\.)?pixiv\.net\/(users|member\.php\?id=)(\d+)\/?/,
    route: (m) => `/pixiv/user/${m[3]}`,
    label: (m) => `Pixiv ${m[3]}`,
  },
  // Steam - game news
  {
    pattern: /^https?:\/\/store\.steampowered\.com\/app\/(\d+)\/?/,
    route: (m) => `/steam/news/${m[1]}`,
    label: (m) => `Steam app ${m[1]}`,
  },
  // NPM - package
  {
    pattern: /^https?:\/\/(www\.)?npmjs\.com\/package\/(@?[A-Za-z0-9_/.-]+)\/?$/,
    route: (m) => `/npm/package/${m[2]}`,
    label: (m) => `npm ${m[2]}`,
  },
  // Docker Hub - image
  {
    pattern: /^https?:\/\/hub\.docker\.com\/r\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/,
    route: (m) => `/dockerhub/build/${m[1]}/${m[2]}`,
    label: (m) => `Docker ${m[1]}/${m[2]}`,
  },
  // GitLab - project
  {
    pattern: /^https?:\/\/gitlab\.com\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\/?$/,
    route: (m) => `/gitlab/explore/projects/${m[1]}`,
    label: (m) => `GitLab ${m[1]}`,
  },
  // TikTok - user
  {
    pattern: /^https?:\/\/(www\.)?tiktok\.com\/@([A-Za-z0-9_.-]+)\/?$/,
    route: (m) => `/tiktok/user/@${m[2]}`,
    label: (m) => `TikTok @${m[2]}`,
  },
  // Twitch - channel
  {
    pattern: /^https?:\/\/(www\.)?twitch\.tv\/([A-Za-z0-9_]+)\/?$/,
    route: (m) => `/twitch/live/${m[2]}`,
    label: (m) => `Twitch ${m[2]}`,
  },
  // Letterboxd - user
  {
    pattern: /^https?:\/\/(www\.)?letterboxd\.com\/([A-Za-z0-9_]+)\/?$/,
    route: (m) => `/letterboxd/user/${m[2]}/diary`,
    label: (m) => `Letterboxd ${m[2]}`,
  },
  // Hacker News - best/new
  {
    pattern: /^https?:\/\/news\.ycombinator\.com\/?$/,
    route: () => `/hackernews/best`,
    label: () => `Hacker News Best`,
  },
];

export interface RSSHubMatch {
  rsshubUrl: string;
  label: string;
}

export function detectRSSHubRoute(url: string): RSSHubMatch | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    new URL(trimmed);
  } catch {
    return null;
  }

  const instance = getRSSHubInstance();

  for (const route of routes) {
    const match = trimmed.match(route.pattern);
    if (match) {
      return {
        rsshubUrl: `${instance}${route.route(match)}`,
        label: route.label(match),
      };
    }
  }

  return null;
}

export function isRSSHubUrl(url: string): boolean {
  const instance = getRSSHubInstance();
  return url.startsWith(instance) || url.startsWith('rsshub://');
}
