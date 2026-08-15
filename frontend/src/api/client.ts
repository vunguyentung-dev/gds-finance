export interface GdsFinConfig {
  restUrl: string;
  nonce: string;
  /** wp_localize_script có truyền, nhưng không phải lúc nào cũng có. */
  user?: string;
  version?: string;
  /**
   * URL đăng xuất do wp_logout_url() sinh ra, đã kèm nonce của hành động log-out.
   * Thiếu trường này thì UserMenu tự lùi về /wp-login.php?action=logout — vẫn là luồng
   * logout của WP, chỉ thêm một bước WP hỏi lại.
   */
  logoutUrl?: string;
}

declare global {
  interface Window {
    GDSFIN?: GdsFinConfig;
  }
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function getConfig(): GdsFinConfig {
  const cfg = window.GDSFIN;
  if (!cfg) throw new ApiError(0, 'Thiếu cấu hình GDSFIN.');
  return cfg;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { restUrl, nonce } = getConfig();
  const res = await fetch(`${restUrl}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-WP-Nonce': nonce,
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : res.statusText;
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Một trang dữ liệu + tổng số, đọc từ header chuẩn WordPress. */
export interface PagedResult<T> {
  items: T[];
  total: number;
  totalPages: number;
  /**
   * false = phản hồi KHÔNG có X-WP-Total, tức endpoint chưa hỗ trợ phân trang.
   * Client phải phân biệt "hết dữ liệu" với "không biết còn bao nhiêu" — đoán bừa
   * thì hoặc giấu mất nút Tải thêm, hoặc hiện tổng số sai.
   */
  paged: boolean;
}

async function requestPaged<T>(path: string): Promise<PagedResult<T>> {
  const { restUrl, nonce } = getConfig();
  const res = await fetch(`${restUrl}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
  });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : res.statusText;
    throw new ApiError(res.status, message);
  }

  const items = (await res.json()) as T[];
  const rawTotal = res.headers.get('X-WP-Total');
  const rawPages = res.headers.get('X-WP-TotalPages');

  if (rawTotal === null) {
    // Backend chưa áp patch: trả hết trong một lượt. Coi như đúng một trang.
    return { items, total: items.length, totalPages: 1, paged: false };
  }

  return {
    items,
    total: Number(rawTotal),
    totalPages: rawPages === null ? 1 : Number(rawPages),
    paged: true,
  };
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  getPaged: <T>(path: string) => requestPaged<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
