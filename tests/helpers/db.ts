import { Client } from 'pg';

/**
 * Doğrudan Postgres bağlantısı.
 *
 * REST API üzerinden yapılan çağrılar her biri kendi işlemi (transaction)
 * içinde koştuğu ve ağ üzerinden sıraya girdiği için işlem seviyesindeki
 * kilitlenme davranışı oradan güvenilir şekilde sınanamıyor. Kilit testleri
 * bu yüzden iki ayrı veritabanı oturumu açıp sıralamayı kendisi kuruyor.
 */
export async function connectDb(): Promise<Client> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    throw new Error(
      'POSTGRES_URL_NON_POOLING tanımlı değil. `vercel env pull .env.local` çalıştırın.',
    );
  }

  // Bağlantı dizesindeki sslmode parametresi pg tarafında verify-full gibi
  // yorumlanıp Supabase'in sertifika zinciriyle çakışıyor; parametreyi ayıklayıp
  // SSL'i açıkça veriyoruz.
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');

  const client = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  return client;
}

/** Belirtilen süre kadar bekler (kilit yarışlarını gözlemlemek için). */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
