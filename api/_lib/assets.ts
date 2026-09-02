import { ServerEnv } from "./env.js";

// Absolute URL to the logo, required because email clients cannot load
// relative paths. Uses the deployed site's own /logo.png.
export function logoUrl(): string {
  return `${ServerEnv.publicSiteUrl()}/logo.png`;
}

export function siteUrl(): string {
  return ServerEnv.publicSiteUrl();
}
