import type { EntryType, FinCategories } from '../../api/finance';
import { describeDong, parseVNNumber } from '../../lib/format';
import { groupOf, isInvType, overdrawError } from './entryType';

export interface DraftState {
  type: EntryType;
  date: string;
  amount: string;
  note: string;
  cat: string;
}

type DraftField = 'date' | 'amount' | 'note' | 'cat';

interface EntryFormProps {
  draft: DraftState;
  categories: FinCategories;
  /** Vốn ròng hiện có, để chặn rút quá tay ngay tại form. null = chưa biết. */
  investedNet: string | null;
  submitting: boolean;
  error: string;
  onTypeChange: (type: EntryType) => void;
  onFieldChange: (key: DraftField, value: string) => void;
  onSubmit: () => void;
}

export function EntryForm({
  draft,
  categories,
  investedNet,
  submitting,
  error,
  onTypeChange,
  onFieldChange,
  onSubmit,
}: EntryFormProps) {
  const group = groupOf(draft.type);
  const isInv = isInvType(draft.type);
  const amountDong = parseVNNumber(draft.amount);
  // Diễn giải số vừa gõ để soát số 0 — ô này nhập theo ĐỒNG đầy đủ
  const amountHint = describeDong(amountDong);
  const overdraw = overdrawError(draft.type, amountDong, investedNet);

  /**
   * fin/invested không đọc được => backend chưa có loại inv_*. Gửi lên backend cũ thì
   * nó quy mọi entry_type khác 'in' về 'out', rồi trả "Danh mục không hợp lệ" — lời lỗi
   * chẳng liên quan gì đến việc người dùng vừa làm. Chặn tại đây và nói đúng nguyên nhân.
   */
  const backendMissing = isInv && investedNet === null;

  return (
    <div className="gf-fin-panel">
      <div className="gf-fin-panel-title">
        {isInv ? 'Nhập khoản đầu tư tài chính' : 'Nhập khoản thu / chi'}
      </div>
      <div className={`gf-fin-form-grid${isInv ? ' is-inv' : ''}`}>
        <div>
          <label className="gf-fin-form-label">Loại</label>
          <div className="gf-fin-type-toggle">
            <button
              type="button"
              className={`gf-fin-type-btn${group === 'in' ? ' is-active-in' : ''}`}
              onClick={() => onTypeChange('in')}
            >
              Thu
            </button>
            <button
              type="button"
              className={`gf-fin-type-btn${group === 'out' ? ' is-active-out' : ''}`}
              onClick={() => onTypeChange('out')}
            >
              Chi
            </button>
            <button
              type="button"
              className={`gf-fin-type-btn${group === 'inv' ? ' is-active-inv' : ''}`}
              onClick={() => onTypeChange('inv_in')}
            >
              Đầu tư
            </button>
          </div>
        </div>

        {isInv && (
          <div>
            <label className="gf-fin-form-label">Chiều</label>
            <div className="gf-fin-type-toggle">
              <button
                type="button"
                className={`gf-fin-type-btn${draft.type === 'inv_in' ? ' is-active-inv' : ''}`}
                onClick={() => onTypeChange('inv_in')}
              >
                Nộp vào
              </button>
              <button
                type="button"
                className={`gf-fin-type-btn${draft.type === 'inv_out' ? ' is-active-inv' : ''}`}
                onClick={() => onTypeChange('inv_out')}
              >
                Rút ra
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="gf-fin-form-label">Ngày</label>
          <input
            type="date"
            className="gf-fin-input gf-num"
            value={draft.date}
            onChange={(e) => onFieldChange('date', e.target.value)}
          />
        </div>

        <div className="gf-fin-amount-cell">
          <label className="gf-fin-form-label">Số tiền (₫)</label>
          <input
            type="text"
            className="gf-fin-input gf-num"
            placeholder={isInv ? '100.000.000' : '5.000.000'}
            value={draft.amount}
            onChange={(e) => onFieldChange('amount', e.target.value)}
          />
          {amountHint && <div className="gf-fin-amount-hint">{amountHint}</div>}
        </div>

        <div>
          <label className="gf-fin-form-label">Ghi chú</label>
          <input
            type="text"
            className="gf-fin-input"
            placeholder={isInv ? 'Chuyển khoản sang TK chứng khoán…' : 'Nội dung khoản này…'}
            value={draft.note}
            onChange={(e) => onFieldChange('note', e.target.value)}
          />
        </div>

        {/* Khoản đầu tư không có danh mục: cat do backend đóng dấu theo chiều. */}
        {!isInv && (
          <div>
            <label className="gf-fin-form-label">Loại thu/chi</label>
            <select
              className="gf-fin-select"
              value={draft.cat}
              onChange={(e) => onFieldChange('cat', e.target.value)}
            >
              {categories[draft.type === 'in' ? 'in' : 'out'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          className="gf-fin-submit"
          onClick={onSubmit}
          disabled={submitting || overdraw !== null || backendMissing}
        >
          + Thêm
        </button>
      </div>

      {backendMissing && (
        <div className="gf-fin-form-error">
          Chưa ghi được khoản đầu tư: backend chưa có endpoint <code>fin/invested</code>.
          Áp patch ở <code>docs/patch-dau-tu.md</code> rồi tải lại trang.
        </div>
      )}
      {isInv && !backendMissing && (
        <div className="gf-fin-form-note">
          Khoản đầu tư là chuyển tiền giữa hai túi của chính bạn, nên{' '}
          <b>không tính vào Thu/Chi</b> tháng hay năm, không vào biểu đồ 12 tháng và
          không vào chi tiêu theo loại. Nó chỉ cộng vào thẻ “Vốn đã bỏ vào thị trường”.
        </div>
      )}
      {overdraw && <div className="gf-fin-form-error">{overdraw}</div>}
      {error && <div className="gf-fin-form-error">{error}</div>}
    </div>
  );
}
