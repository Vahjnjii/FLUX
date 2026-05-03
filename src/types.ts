export interface ApiKey {
  key: string;
  cooldownUntil: number | null; // Timestamp
}

export interface PageProfile {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface PostResult {
  id: string;
  topic: string;
  shortText: string;
  longText: string;
  imageUrl: string;
  compositedImageUrl: string;
  pageProfileId: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

export interface ImageNode {
  url: string;
  cooldownUntil: number | null;
}

export interface AppSettings {
  imageNodes: ImageNode[];
  useCustomImageApi: boolean;
  githubToken: string | null;
  githubRepo: string | null;
  githubPath: string | null;
  autoSync: boolean;
  useGithubAssets: boolean;
  accessCode: string | null;
  userName: string | null;
  sessionStartedAt: number | null;
}

export interface AppState {
  apiKeys: ApiKey[];
  profiles: PageProfile[];
  results: PostResult[];
  settings: AppSettings;
}
