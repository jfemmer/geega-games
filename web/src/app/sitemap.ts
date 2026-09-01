import type { MetadataRoute } from 'next';

const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/cards`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/sell`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/trade-in`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
