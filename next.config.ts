import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  // A stray lockfile in the home directory otherwise makes Next guess the wrong project root.
  turbopack: { root: import.meta.dirname },
}

export default nextConfig
