import type { NextRequest } from 'next/server';
import { handleRoute, jsonResponse } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getRecentStockLogs } from '@/lib/repo/stock-logs';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * GET /api/stock-log?limit=20 - son stok ve fiyat hareketleri
 *
 * Ana paneldeki hareket listesinin kaynağı.
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const supabase = await createSupabaseServerClient();
    await requireUser(supabase);

    const requested = Number(request.nextUrl.searchParams.get('limit'));
    const limit =
      Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;

    const logs = await getRecentStockLogs(supabase, limit);

    return jsonResponse({ logs });
  });
}
