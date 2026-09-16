import type { AuthMode, AuthTokens } from '@inwit/dto';

export function authModeFromOrigin(origin: string | undefined, webOrigin: string): AuthMode {
  return origin === webOrigin ? 'cookie' : 'bearer';
}

export function tokensForMode(
  mode: AuthMode,
  input: { accessToken: string; refreshToken: string; expiresIn: number },
): AuthTokens | undefined {
  if (mode === 'cookie') return undefined;
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresIn: input.expiresIn,
  };
}
