import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    // Ev dizininde başıboş bir package-lock.json bulunduğu için Turbopack
    // proje kökünü yukarıda arıyordu; kökü açıkça bu projeye sabitliyoruz.
    root: path.join(__dirname),
  },
};

export default nextConfig;
