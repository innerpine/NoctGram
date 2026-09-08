import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Vinext dev examines all multipart POSTs as potential progressive actions
    // before API routing. Allow 25 MiB files plus their multipart envelope.
    // Upload routes still enforce their actual application file limits.
    serverActions: { bodySizeLimit: '26mb' },
  },
};

export default nextConfig;
