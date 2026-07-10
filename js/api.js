// 데이터 레이어: Supabase 클라이언트 + 조회/저장 헬퍼
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=18';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 테이블 전체 조회 (1000행 페이지 한도를 넘어도 전부 가져옴)
export async function fetchAll(table, orderCol = 'created_at') {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table)
      .select('*')
      .order(orderCol, { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}
