export class ApiError extends Error {
  constructor(message, { status = 0, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Could not reach CultAnime. Check your connection and try again.', { cause: error });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data?.error || `Request failed (${response.status}).`, { status: response.status });
  }
  return data;
}
