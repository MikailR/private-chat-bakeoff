export type Role = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export type ModelPhase = 'loading' | 'ready' | 'generating' | 'error';

export interface ProgressDetail {
  status: string;
  file: string;
  progress: number | null;
  loaded: number | null;
  total: number | null;
}
