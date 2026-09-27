/** Base URL of the Redline endpoints. */
export const ENDPOINT = '/__redline';

/** History builds are served under `/__redline/h/<sha>/`. */
export const HISTORY_PREFIX = `${ENDPOINT}/h/`;

export const isFullSha = (sha: string): boolean => /^[0-9a-f]{40}$/.test(sha);

/** Vite `base` and iframe URL for the build of `sha`. */
export const historyBasePath = (sha: string): string => `${HISTORY_PREFIX}${sha}/`;
