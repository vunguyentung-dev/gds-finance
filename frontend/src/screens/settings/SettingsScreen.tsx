import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { getProfile, saveProfile, type Profile } from '../../api/settings';
import { getRates, upsertRate, type RateTier } from '../../api/stock';
import { formatDateVN, formatVN, parseVNNumber, todayIso } from '../../lib/format';
import '../../styles/settings.css';
import { NewsFeedCard } from './NewsFeedCard';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

const APP_VERSION = '1.0.0';

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

/** Mốc đang hiệu lực hôm nay = mốc cuối cùng có eff_date <= hôm nay (mục 2.1). */
function currentRateOf(rates: RateTier[]): RateTier | null {
  const today = todayIso();
  let cur: RateTier | null = rates[0] ?? null;
  for (const r of rates) if (r.eff_date <= today) cur = r;
  return cur;
}

const pct = (v: string) => `${formatVN(Number(v), 2)}%`;

export function SettingsScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [profile, setProfile] = useState<Profile>({ name: '', broker: '', account: '' });
  const [profileSave, setProfileSave] = useState<SaveState>('idle');
  const [profileError, setProfileError] = useState('');

  const [rates, setRates] = useState<RateTier[]>([]);
  const [rateDraft, setRateDraft] = useState({ buyFee: '0,15', sellFee: '0,15', tax: '0,10', date: todayIso() });
  const [rateBusy, setRateBusy] = useState(false);
  const [rateError, setRateError] = useState('');
  const [rateOk, setRateOk] = useState('');

  const pendingProfile = useRef<Partial<Profile>>({});
  const timer = useRef<number | null>(null);

  const flushProfile = useCallback(async (silent = false) => {
    const patch = pendingProfile.current;
    if (Object.keys(patch).length === 0) return;
    pendingProfile.current = {};
    if (!silent) setProfileSave('saving');
    try {
      const saved = await saveProfile(patch);
      if (!silent) {
        setProfile(saved);
        setProfileSave('saved');
        setProfileError('');
      }
    } catch (err) {
      if (!silent) {
        setProfileSave('dirty');
        setProfileError(errorMessageOf(err));
      }
    }
  }, []);

  const load = useCallback((ignore: { current: boolean }) => {
    Promise.all([getProfile(), getRates()]).then(
      ([p, rs]) => {
        if (ignore.current) return;
        setProfile(p);
        setRates(rs);
        setState('ready');
      },
      (err) => {
        if (ignore.current) return;
        if (isForbidden(err)) setState('forbidden');
        else {
          setErrorMessage(errorMessageOf(err));
          setState('error');
        }
      },
    );
  }, []);

  useEffect(() => {
    const ignore = { current: false };
    load(ignore);
    return () => {
      ignore.current = true;
      if (timer.current) clearTimeout(timer.current);
      void flushProfile(true);
    };
  }, [load, flushProfile]);

  const handleProfile = (key: keyof Profile, value: string) => {
    setProfile((p) => ({ ...p, [key]: value }));
    pendingProfile.current = { ...pendingProfile.current, [key]: value };
    setProfileSave('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flushProfile(), 800);
  };

  const handleApplyRate = async () => {
    const buy = parseVNNumber(rateDraft.buyFee);
    const sell = parseVNNumber(rateDraft.sellFee);
    const tax = parseVNNumber(rateDraft.tax);
    if (!rateDraft.date) {
      setRateError('Cần chọn ngày hiệu lực.');
      return;
    }
    if (buy < 0 || sell < 0 || tax < 0) {
      setRateError('Phí và thuế không được âm.');
      return;
    }
    setRateBusy(true);
    setRateError('');
    setRateOk('');
    try {
      const res = await upsertRate({
        eff_date: rateDraft.date,
        buy_fee: String(buy),
        sell_fee: String(sell),
        tax: String(tax),
      });
      setRates(await getRates());
      setRateOk(
        res.upserted === 'update'
          ? `Đã ghi đè mốc ${formatDateVN(rateDraft.date)}.`
          : `Đã thêm mốc hiệu lực từ ${formatDateVN(rateDraft.date)}.`,
      );
    } catch (err) {
      setRateError(errorMessageOf(err));
    } finally {
      setRateBusy(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="gf-set-state">
        <div className="gf-set-state-title">Đang tải dữ liệu…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-set-state">
        <div className="gf-set-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-set-state">
        <div className="gf-set-state-title">Không tải được dữ liệu.</div>
        <div>{errorMessage}</div>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            load({ current: false });
          }}
        >
          Thử lại
        </button>
      </div>
    );
  }

  const current = currentRateOf(rates);
  const history = [...rates].reverse();
  const savingLabel =
    profileSave === 'saving'
      ? 'Đang lưu…'
      : profileSave === 'dirty'
        ? 'Chưa lưu'
        : profileSave === 'saved'
          ? 'Đã lưu'
          : '';

  return (
    <div className="gf-set">
      <div className="gf-set-card">
        <div className="gf-set-head">
          <div className="gf-set-title" style={{ marginBottom: 0 }}>
            Thông tin cá nhân
          </div>
          {savingLabel && (
            <span className={`gf-set-saving${profileSave === 'dirty' ? ' dirty' : ''}`}>{savingLabel}</span>
          )}
        </div>
        <div className="gf-set-fields">
          <div>
            <label className="gf-set-label">Tên người dùng</label>
            <input
              type="text"
              className="gf-set-input"
              value={profile.name}
              onChange={(e) => handleProfile('name', e.target.value)}
            />
          </div>
          <div>
            <label className="gf-set-label">Công ty chứng khoán</label>
            <input
              type="text"
              className="gf-set-input"
              value={profile.broker}
              onChange={(e) => handleProfile('broker', e.target.value)}
            />
          </div>
          <div>
            <label className="gf-set-label">Số tài khoản</label>
            <input
              type="text"
              className="gf-set-input gf-num"
              value={profile.account}
              onChange={(e) => handleProfile('account', e.target.value)}
            />
          </div>
        </div>
        {profileError && <div className="gf-set-error">{profileError}</div>}
      </div>

      <div className="gf-set-card">
        <div className="gf-set-title">Đăng nhập &amp; mật khẩu</div>
        <div className="gf-set-note">
          Tài khoản và mật khẩu do WordPress quản lý, không đổi trong ứng dụng này. Để đổi mật khẩu, mở{' '}
          <a href="/wp-admin/profile.php" target="_blank" rel="noreferrer">
            trang cá nhân WordPress
          </a>{' '}
          rồi dùng mục “New Password”.
          <br />
          <br />
          Quyền truy cập các màn nghiệp vụ dựa trên capability <code>fin_view</code> và <code>fin_manage</code>, do
          quản trị viên cấp.
        </div>
      </div>

      <div className="gf-set-current">
        <div className="gf-set-title">Biểu phí &amp; thuế hiện hành</div>
        <div className="gf-set-current-since">
          {current ? `Áp dụng từ ${formatDateVN(current.eff_date)}` : 'Chưa có mốc nào'}
        </div>
        {current && (
          <>
            <div className="gf-set-rate-row gf-num">
              <span>Phí mua</span>
              <b>{pct(current.buy_fee)}</b>
            </div>
            <div className="gf-set-rate-row gf-num">
              <span>Phí bán</span>
              <b>{pct(current.sell_fee)}</b>
            </div>
            <div className="gf-set-rate-row gf-num">
              <span>Thuế bán</span>
              <b>{pct(current.tax)}</b>
            </div>
          </>
        )}
      </div>

      <div className="gf-set-card wide">
        <div className="gf-set-title tight">Cập nhật biểu phí / thuế</div>
        <div className="gf-set-sub">
          Biểu phí mới chỉ áp dụng cho giao dịch <b>kể từ ngày hiệu lực</b>; giao dịch trước đó giữ nguyên mốc cũ. Gửi
          lại cùng một ngày hiệu lực sẽ <b>ghi đè</b> mốc đó. Sửa biểu phí là thay đổi hồi tố — mọi giao dịch có ngày
          từ mốc này trở đi sẽ được tính lại lãi/lỗ.
        </div>
        <div className="gf-set-rateform">
          <div>
            <label className="gf-set-label">Phí mua (%)</label>
            <input
              type="text"
              className="gf-set-input gf-num"
              value={rateDraft.buyFee}
              onChange={(e) => setRateDraft((d) => ({ ...d, buyFee: e.target.value }))}
            />
          </div>
          <div>
            <label className="gf-set-label">Phí bán (%)</label>
            <input
              type="text"
              className="gf-set-input gf-num"
              value={rateDraft.sellFee}
              onChange={(e) => setRateDraft((d) => ({ ...d, sellFee: e.target.value }))}
            />
          </div>
          <div>
            <label className="gf-set-label">Thuế bán (%)</label>
            <input
              type="text"
              className="gf-set-input gf-num"
              value={rateDraft.tax}
              onChange={(e) => setRateDraft((d) => ({ ...d, tax: e.target.value }))}
            />
          </div>
          <div>
            <label className="gf-set-label">Áp dụng từ ngày</label>
            <input
              type="date"
              className="gf-set-input gf-num"
              value={rateDraft.date}
              onChange={(e) => setRateDraft((d) => ({ ...d, date: e.target.value }))}
            />
          </div>
          <button type="button" className="gf-set-btn" onClick={handleApplyRate} disabled={rateBusy}>
            Áp dụng
          </button>
        </div>
        {rateError && <div className="gf-set-error">{rateError}</div>}
        {rateOk && <div className="gf-set-ok">{rateOk}</div>}
      </div>

      <div className="gf-set-table-wrap">
        <div className="gf-set-table-title">Lịch sử biểu phí</div>
        <table className="gf-set-table gf-num">
          <thead>
            <tr>
              <th>Hiệu lực từ</th>
              <th>Phí mua</th>
              <th>Phí bán</th>
              <th>Thuế bán</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id ?? r.eff_date}>
                <td>
                  <b>{formatDateVN(r.eff_date)}</b>
                  {current && r.eff_date === current.eff_date && <span className="gf-set-badge">Hiện hành</span>}
                </td>
                <td>{pct(r.buy_fee)}</td>
                <td>{pct(r.sell_fee)}</td>
                <td>{pct(r.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewsFeedCard />

      <div className="gf-set-card gf-set-about">
        <div className="gf-set-logo">FM</div>
        <div>
          <div className="gf-set-about-name">FIN MANAGEMENT (FM)</div>
          <div className="gf-set-about-sub">
            About this software: Written by TUNGVN · version {window.GDSFIN?.version ?? APP_VERSION}
          </div>
        </div>
      </div>
    </div>
  );
}
