import type { MetadataRoute } from 'next';

const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Never index private/admin/account/auth areas.
        disallow: ['/admin', '/account', '/cart', '/checkout', '/login', '/signup', '/api'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
