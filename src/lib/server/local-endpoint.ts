export const isLocalEndpoint = (endpoint: string) => {
  try {
    const url = new URL(endpoint);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
};

export const normalizeEndpoint = (endpoint: string) => endpoint.replace(/\/$/, "");
