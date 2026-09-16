import type {
  AssetMultipartCompleteInput,
  AssetMultipartCompleteResponse,
  AssetMultipartInitInput,
  AssetMultipartInitResponse,
  AssetMultipartSignInput,
  AssetMultipartSignResponse,
  AssetResolveInput,
  AssetResolveResponse,
  AssetUploadInput,
  AssetUploadResponse,
} from '@inwit/dto';
import { request } from './client';

export function presignAsset(input: AssetUploadInput): Promise<AssetUploadResponse> {
  return request<AssetUploadResponse>('/api/assets/presign', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function resolveAssetUrls(input: AssetResolveInput): Promise<AssetResolveResponse> {
  return request<AssetResolveResponse>('/api/assets/resolve', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function initAssetMultipart(
  input: AssetMultipartInitInput,
): Promise<AssetMultipartInitResponse> {
  return request<AssetMultipartInitResponse>('/api/assets/multipart/init', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function signAssetMultipart(
  input: AssetMultipartSignInput,
): Promise<AssetMultipartSignResponse> {
  return request<AssetMultipartSignResponse>('/api/assets/multipart/sign', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function completeAssetMultipart(
  input: AssetMultipartCompleteInput,
): Promise<AssetMultipartCompleteResponse> {
  return request<AssetMultipartCompleteResponse>('/api/assets/multipart/complete', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
