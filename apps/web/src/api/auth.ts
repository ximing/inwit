import type { AuthResponse, LoginInput, RegisterInput, User } from '@inwit/dto';
import { request } from './client';

export function registerUser(input: RegisterInput): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function loginUser(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function logoutUser(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export function getMe(): Promise<User> {
  return request<User>('/api/auth/me');
}
