import type { EntryType, FinCategories } from '../../api/finance';

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
  submitting: boolean;
  error: string;
  onTypeChange: (type: EntryType) => void;
  onFieldChange: (key: DraftField, value: string) => void;
  onSubmit: () => void;
}

export function EntryForm({
  draft,
  categories,
  submitting,
  error,
  onTypeChange,
  onFieldChange,
  onSubmit,
}: EntryFormProps) {
  const catOptions = categories[draft.type];

  return (
    <div className="gf-fin-panel">
      <div className="gf-fin-panel-title">Nhập khoản thu / chi</div>
      <div className="gf-fin-form-grid">
        <div>
          <label className="gf-fin-form-label">Loại</label>
          <div className="gf-fin-type-toggle">
            <button
              type="button"
              className={`gf-fin-type-btn${draft.type === 'in' ? ' is-active-in' : ''}`}
              onClick={() => onTypeChange('in')}
            >
              Thu
            </button>
            <button
              type="button"
              className={`gf-fin-type-btn${draft.type === 'out' ? ' is-active-out' : ''}`}
              onClick={() => onTypeChange('out')}
            >
              Chi
            </button>
          </div>
        </div>
        <div>
          <label className="gf-fin-form-label">Ngày</label>
          <input
            type="date"
            className="gf-fin-input gf-num"
            value={draft.date}
            onChange={(e) => onFieldChange('date', e.target.value)}
          />
        </div>
        <div>
          <label className="gf-fin-form-label">Số tiền (nghìn ₫)</label>
          <input
            type="text"
            className="gf-fin-input gf-num"
            placeholder="5.000"
            value={draft.amount}
            onChange={(e) => onFieldChange('amount', e.target.value)}
          />
        </div>
        <div>
          <label className="gf-fin-form-label">Ghi chú</label>
          <input
            type="text"
            className="gf-fin-input"
            placeholder="Nội dung khoản này…"
            value={draft.note}
            onChange={(e) => onFieldChange('note', e.target.value)}
          />
        </div>
        <div>
          <label className="gf-fin-form-label">Loại thu/chi</label>
          <select className="gf-fin-select" value={draft.cat} onChange={(e) => onFieldChange('cat', e.target.value)}>
            {catOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="gf-fin-submit" onClick={onSubmit} disabled={submitting}>
          + Thêm
        </button>
      </div>
      {error && <div className="gf-fin-form-error">{error}</div>}
    </div>
  );
}
