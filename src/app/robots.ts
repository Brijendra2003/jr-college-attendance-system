import type { MetadataRoute } from 'next';

// A private records system: nothing should be indexed.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
