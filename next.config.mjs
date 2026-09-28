/** @type {import('next').NextConfig} */
const nextConfig = {
  // One host. www served a full duplicate of the site (every page 200, same
  // ETag). 308 = permanent; path and query string are carried over.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.yardsperpass.com" }],
        destination: "https://yardsperpass.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
