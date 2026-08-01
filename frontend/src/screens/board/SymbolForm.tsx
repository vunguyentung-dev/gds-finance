import type { Exchange } from '../../api/market';

export interface SymbolDraft {
  sym: string;
  name: string;
  exchange: Exchange;
  sector: string;
  in_vn30: boolean;
}

interface Props {
  draft: SymbolDraft;
  submitting: boolean;
  error: string;
  onChange: <K extends keyof SymbolDraft>(key: K, value: SymbolDraft[K]) => void;
  onSubmit: () => void;
}

const EXCHANGES: Exchange[] = ['HOSE', 'HNX', 'UPCOM'];

/**
 * Thêm mã vào danh sách theo dõi (POST fin/symbols, upsert).
 *
 * Bảng giá không tự có mã nào: fin_symbols là dữ liệu THAM CHIẾU do người dùng khai.
 * Sàn là trường bắt buộc vì biên độ Trần/Sàn phụ thuộc nó — thiếu sàn thì hai cột đó
 * trả null (mục 10), không đoán bằng biên của HOSE.
 */
export function SymbolForm({ draft, submitting, error, onChange, onSubmit }: Props) {
  return (
    <div className="gf-board-panel">
      <div className="gf-board-panel-title">Thêm mã theo dõi</div>
      <div className="gf-board-panel-sub">
        Sàn quyết định biên độ Trần/Sàn (HOSE 7% · HNX 10% · UPCOM 15%) và bước giá, nên bắt buộc chọn đúng. Nhập lại
        mã đã có sẽ cập nhật thông tin cũ.
      </div>

      <div className="gf-board-form">
        <div>
          <label className="gf-board-label">Mã CP</label>
          <input
            type="text"
            className="gf-board-fld sym"
            placeholder="VD: FPT"
            value={draft.sym}
            onChange={(e) => onChange('sym', e.target.value)}
          />
        </div>

        <div>
          <label className="gf-board-label">Tên công ty</label>
          <input
            type="text"
            className="gf-board-fld"
            placeholder="VD: FPT Corp"
            value={draft.name}
            onChange={(e) => onChange('name', e.target.value)}
          />
        </div>

        <div>
          <label className="gf-board-label">Sàn</label>
          <div className="gf-board-seg">
            {EXCHANGES.map((ex) => (
              <button
                key={ex}
                type="button"
                className={`gf-board-seg-btn${draft.exchange === ex ? ' on' : ''}`}
                onClick={() => onChange('exchange', ex)}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="gf-board-label">Ngành</label>
          <input
            type="text"
            className="gf-board-fld"
            placeholder="VD: Công nghệ"
            value={draft.sector}
            onChange={(e) => onChange('sector', e.target.value)}
          />
        </div>

        <label className="gf-board-check">
          <input type="checkbox" checked={draft.in_vn30} onChange={(e) => onChange('in_vn30', e.target.checked)} />
          <span>Thuộc VN30</span>
        </label>

        <button type="button" className="gf-board-submit" onClick={onSubmit} disabled={submitting}>
          + Thêm
        </button>
      </div>

      {error && <div className="gf-board-error">{error}</div>}
    </div>
  );
}
