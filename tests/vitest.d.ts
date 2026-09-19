declare module 'vitest' {
  /** globalSetup içinden `provide` ile aktarılan değerler. */
  interface ProvidedContext {
    /** HTTP testlerinin kullandığı paylaşımlı geliştirme sunucusunun adresi. */
    baseUrl: string;
  }
}

export {};
