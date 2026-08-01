/**
 * Nội dung tĩnh của checklist — gốc `checklistDefs` dòng 903-931 VNInvest.dc.html.
 * Để ở frontend theo docs/api-spec.md mục 5: đây là văn bản thiết kế, không phải
 * dữ liệu người dùng, nên không đưa vào DB.
 */

export interface GroupBanner {
  kind: 'banner';
  stt: string;
  label: string;
  tone: 'buy' | 'sell';
}

export interface CriterionRow {
  kind: 'row';
  /** Khoá gửi lên API — sinh đúng công thức gốc dòng 1290. */
  rowKey: string;
  stt: string;
  label: string;
  explain: string;
  note?: string;
}

export type ChecklistEntry = GroupBanner | CriterionRow;

interface RawDef {
  grp?: boolean;
  head?: string;
  stt?: string;
  crit?: string;
  sub?: string;
  tone?: 'buy' | 'sell';
  explain?: string;
  note?: string;
}

const raw: RawDef[] = [
  { grp: true, stt: '1', crit: 'Phân tích cơ bản', explain: 'Doanh nghiệp tốt, lợi nhuận dương, tiền mặt nhiều, nợ ít, hoạt động kinh doanh hiệu quả, hưởng lợi chính sách.' },
  { grp: true, stt: '2', crit: 'Định giá', explain: 'Downtrend: định giá dưới giá trị sổ sách trung bình ngành. Uptrend: tùy vào kỳ vọng.' },
  { grp: true, stt: '3', crit: 'Xu hướng', explain: 'Uptrend trên MA50 nhích nhẹ xuống rồi đẩy ngược lên; downtrend thì tìm CP có xu hướng uptrend không quá 100 ngày.' },
  { grp: true, stt: '4', crit: 'Tình hình vĩ mô', explain: 'Không có biến động nào có nguy cơ thiên nga đen.' },
  { grp: true, stt: '5', crit: 'Nhóm ngành', explain: 'Những nhóm ngành dẫn dắt thị trường.' },
  { grp: true, stt: '6', crit: 'Cổ tức', explain: 'Đều đặn hàng năm.' },
  { grp: true, stt: '7', crit: 'Triển vọng tương lai', explain: 'Có kỳ vọng tương lai.' },
  { grp: true, stt: '8', crit: 'Rủi ro tiềm tàng', explain: 'Tỉ lệ rủi ro.' },

  { head: '9', crit: 'Điểm mua', tone: 'buy' },
  { stt: '9', sub: 'RSI', explain: 'RSI quá bán khi bán hoảng loạn; vùng giữa kênh dưới khi bình thường. Khung 1 ngày quá bán <30 nhưng khung 1 giờ đã >30 (lý tưởng: đã hình thành đáy RSI quá bán số 2). Đáy kênh trên <50, đáy kênh dưới <30, không áp dụng khung 1h.', note: 'Đáy 1 vol lớn thì mua T+ nhưng vẫn phải RSI khung 1h >30. Nếu xuất hiện đáy thứ 2 thì tùy tình hình xem có thể lên 20-30% không. Thị trường khó nên chốt 5-10% ở đáy 1, chốt 10-20% sau đáy 2.' },
  { stt: '9', sub: 'Điểm %', explain: 'Mua ở điểm − % thấp nhất.' },
  { stt: '9', sub: 'Volume', explain: 'Volume đã kiệt.' },
  { stt: '9', sub: 'Phân kỳ', explain: 'Phân kỳ dương.' },
  { stt: '9', sub: 'Đáy', explain: 'Nên mua ở đáy số 2 thường kiệt cung. Khoảng cách giữa 2 đáy phải trên 4 ngày.' },
  { stt: '9', sub: 'BB', explain: 'Vùng quá bán, khi BB bị bóp nhỏ và đang trong quá trình bóp nhỏ (kết hợp vĩ mô và số cây giảm theo ngày). Quá 7 ngày giảm liên tục có thể mở mua ăn T+. BB thắt chặt rồi rơi 3-4 nhịp là điểm mua.' },
  { stt: '9', sub: 'Thời gian xu hướng', explain: 'Không quá 100 ngày.', note: 'Có thể đang ở thời kỳ trend mới sau khi thị trường điều chỉnh xu hướng sau 100 ngày.' },
  { stt: '9', sub: 'Thời gian giảm liên tục', explain: 'Giảm liên tục 20 ngày có thể cân nhắc mua.' },
  { stt: '9', sub: 'Tâm lý', explain: 'Hoảng loạn, vừa qua hoảng loạn, ổn định.' },

  { head: '10', crit: 'Điểm bán', tone: 'sell' },
  { stt: '10', sub: 'RSI', explain: 'Chỉ bán kênh trên vùng quá mua.' },
  { stt: '10', sub: 'Điểm %', explain: 'Bán ở điểm + % cao nhất.' },
  { stt: '10', sub: 'Volume', explain: 'Volume nhỏ dần.' },
  { stt: '10', sub: 'Phân kỳ', explain: 'Phân kỳ âm.' },
  { stt: '10', sub: 'Đỉnh', explain: 'Bán ở đỉnh số 1.' },
  { stt: '10', sub: 'BB', explain: 'Vùng quá mua.' },
  { stt: '10', sub: 'Thời gian xu hướng', explain: 'Không quá 100 ngày.' },
  { stt: '10', sub: 'Tâm lý', explain: 'Ổn định, hưng phấn, FOMO.' },
];

export const checklistEntries: ChecklistEntry[] = raw.map((d, i) => {
  if (d.head) {
    return { kind: 'banner', stt: d.head, label: `${d.head}. ${d.crit ?? ''}`, tone: d.tone ?? 'buy' };
  }
  // Công thức khoá gốc: (stt || '') + '_' + (sub || crit || i)
  const rowKey = `${d.stt ?? ''}_${d.sub ?? d.crit ?? i}`;
  return {
    kind: 'row',
    rowKey,
    stt: d.grp ? (d.stt ?? '') : '',
    label: d.crit ?? d.sub ?? '',
    explain: d.explain ?? '',
    note: d.note,
  };
});

/** Tổng số dòng tiêu chí — 25. Backend không biết số này vì nội dung tĩnh ở frontend. */
export const TOTAL_CRITERIA = checklistEntries.filter((e) => e.kind === 'row').length;
