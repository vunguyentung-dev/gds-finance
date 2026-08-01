import { apiClient } from './client';

export interface NewsItem {
  id: string;
  source: string;
  title: string;
  link: string;
  published_at: string | null;
  fetched_at: string;
  summary: string | null;
  /** Mã đang nắm khớp được trong tiêu đề/tóm tắt. Rỗng = không khớp mã nào. */
  syms: string[];
  /** Cờ do CHÍNH user gắn. Không có nhãn Tốt/Xấu tự động (api-spec 13.6). */
  flag: 'save' | 'watch' | null;
}

export interface FeedHealth {
  name: string;
  url: string;
  is_default: boolean;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  last_items: number | null;
}

export interface NewsResponse {
  scope: 'all' | 'portfolio';
  items: NewsItem[];
  held: string[];
  coverage: { total: number; shown: number; matched: number; from: string | null; to: string | null };
  feeds_health: FeedHealth[];
  next_cron: string | null;
}

export interface FetchResult {
  as_of: string;
  purged: number;
  feeds: {
    name: string;
    url: string;
    ok: boolean;
    http: number | null;
    items: number;
    inserted: number;
    skipped_guid: number;
    skipped_title: number;
    error: string | null;
  }[];
}

export interface NewsFeed {
  id: string | null;
  name: string;
  url: string;
  is_active: boolean;
  is_default: boolean;
}

export function getNews(scope: 'all' | 'portfolio') {
  return apiClient.get<NewsResponse>(`fin/news?scope=${scope}`);
}

export function fetchNewsNow() {
  return apiClient.post<FetchResult>('fin/news/fetch', {});
}

export function setNewsFlag(id: string, flag: 'save' | 'watch' | '') {
  return apiClient.put<{ flag: string | null }>(`fin/news/${id}/flag`, { flag });
}

export function getNewsFeeds() {
  return apiClient.get<NewsFeed[]>('fin/news-feeds');
}

export function addNewsFeed(name: string, url: string) {
  return apiClient.post<{ id: string; probe: FetchResult['feeds'][number] }>('fin/news-feeds', { name, url });
}

export function deleteNewsFeed(id: string) {
  return apiClient.delete<{ deleted: number }>(`fin/news-feeds/${id}`);
}
