import type {
  AccessToken,
  AccessTokenLog,
  AccessTokenSecret,
  AuthResponse,
  AvatarUploadUrlInput,
  AvatarUploadUrlResponse,
  ConfirmAvatarInput,
  CreateAccessTokenInput,
  ListAccessTokenLogsQuery,
  LoginInput,
  Paginated,
  RegisterInput,
  UpdateProfileInput,
  User,
} from '@inwit/dto';
import { persistAuth, request } from './client';
import { tokenStore } from './tauri';

export async function registerUser(input: RegisterInput): Promise<AuthResponse> {
  const response = await request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
    skipAuth: true,
    skipAuthRefresh: true,
  });
  await persistAuth(response.tokens);
  return response;
}

export async function loginUser(input: LoginInput): Promise<AuthResponse> {
  const response = await request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
    skipAuth: true,
    skipAuthRefresh: true,
  });
  await persistAuth(response.tokens);
  return response;
}

export async function logoutUser(): Promise<void> {
  try {
    await request<void>('/api/auth/logout', { method: 'POST', skipAuthRefresh: true });
  } finally {
    await tokenStore.clear();
  }
}

export function getMe(): Promise<User> {
  return request<User>('/api/auth/me');
}

export function updateMe(input: UpdateProfileInput): Promise<User> {
  return request<User>('/api/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function requestAvatarUploadUrl(
  input: AvatarUploadUrlInput,
): Promise<AvatarUploadUrlResponse> {
  return request<AvatarUploadUrlResponse>('/api/me/avatar/upload-url', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function confirmAvatar(input: ConfirmAvatarInput): Promise<User> {
  return request<User>('/api/me/avatar', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listAccessTokens(): Promise<AccessToken[]> {
  return request<AccessToken[]>('/api/me/access-tokens');
}

export function createAccessToken(input: CreateAccessTokenInput): Promise<AccessToken> {
  return request<AccessToken>('/api/me/access-tokens', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revealAccessToken(id: string): Promise<AccessTokenSecret> {
  return request<AccessTokenSecret>(`/api/me/access-tokens/${id}/reveal`, { method: 'POST' });
}

export function listAccessTokenLogs(
  query: Partial<ListAccessTokenLogsQuery> = {},
): Promise<Paginated<AccessTokenLog>> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.accessTokenId) params.set('accessTokenId', query.accessTokenId);
  const qs = params.toString();
  return request<Paginated<AccessTokenLog>>(
    qs ? `/api/me/access-token-logs?${qs}` : '/api/me/access-token-logs',
  );
}
