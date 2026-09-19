import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `globals: false` kullandığımız için React Testing Library'nin otomatik
// temizliği devreye girmiyor; her testten sonra elle çağırıyoruz.
afterEach(() => {
  cleanup();
});
