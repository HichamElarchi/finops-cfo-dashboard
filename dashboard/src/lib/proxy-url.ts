export function publicProxyOrigin() {
  const configured = (
    process.env.NEXT_PUBLIC_PROXY_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_PROXY_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, "")}`
      : "") ||
    "https://finops-cfo-dashboard.vercel.app"
  ).replace(/\/$/, "");
  return configured.endsWith("/v1") ? configured.slice(0, -3) : configured;
}

export function publicProxyBaseUrl() {
  return `${publicProxyOrigin()}/v1`;
}

export function proxyOrigin() {
  return (
    process.env.NEXT_PUBLIC_PROXY_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_PROXY_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}
