/**
 * Runtime configuration. The API base URL is injected from VITE_API_BASE_URL
 * so the SAME build can target the local smoke harness
 * (http://localhost:4000) or a real deployment
 * (https://<api-id>.execute-api.ap-south-1.amazonaws.com) without code changes.
 */
export interface RuntimeConfig {
  apiBaseUrl: string;
}

const DEFAULT_API_BASE_URL = 'http://localhost:4000';

export const runtimeConfig: RuntimeConfig = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, ''),
};
