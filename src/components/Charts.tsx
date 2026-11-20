import React from 'react';

export function OrderTrendChart({
  data,
}: {
  data: Array<{ date: string; galon: number; fotokopi: number; laminating: number }>;
}) {
  if (!data || data.length === 0) {
    return <p className="text-xs text-slate-500 py-8 text-center">Belum ada data tren pesanan.</p>;
  }

  const maxVal = Math.max(
    4,
    ...data.map((d) => d.galon + d.fotokopi + d.laminating)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-[#1755CE]" />
          Air Galon
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" />
          Fotokopi
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />
          Laminating
        </span>
      </div>

      <div className="grid grid-cols-7 gap-2 items-end h-44 pt-4 border-b border-slate-200 pb-2">
        {data.map((item) => {
          const total = item.galon + item.fotokopi + item.laminating;
          const hGal = (item.galon / maxVal) * 100;
          const hFcp = (item.fotokopi / maxVal) * 100;
          const hLam = (item.laminating / maxVal) * 100;

          return (
            <div key={item.date} className="flex flex-col items-center justify-end h-full group">
              <span className="text-[11px] font-mono tabular-nums text-slate-500 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {total}
              </span>
              <div className="w-full max-w-[34px] flex flex-col-reverse justify-start rounded-t overflow-hidden bg-slate-100 h-32">
                {item.galon > 0 && (
                  <div
                    style={{ height: `${hGal}%` }}
                    className="bg-[#1755CE] w-full transition-all"
                    title={`Air Galon: ${item.galon}`}
                  />
                )}
                {item.fotokopi > 0 && (
                  <div
                    style={{ height: `${hFcp}%` }}
                    className="bg-amber-500 w-full transition-all"
                    title={`Fotokopi: ${item.fotokopi}`}
                  />
                )}
                {item.laminating > 0 && (
                  <div
                    style={{ height: `${hLam}%` }}
                    className="bg-emerald-600 w-full transition-all"
                    title={`Laminating: ${item.laminating}`}
                  />
                )}
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-500 mt-1.5">
                {item.date}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HorizontalUnitBarChart({
  data,
}: {
  data: Array<{ unitName: string; count: number }>;
}) {
  if (!data || data.length === 0) {
    return <p className="text-xs text-slate-500 py-8 text-center">Belum ada data distribusi unit.</p>;
  }
  const maxVal = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="space-y-3">
      {data.slice(0, 6).map((row) => {
        const pct = Math.round((row.count / maxVal) * 100);
        return (
          <div key={row.unitName} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 truncate">{row.unitName}</span>
              <span className="font-mono tabular-nums text-slate-900 font-semibold">
                {row.count} order
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#1755CE] rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PhotocopyVolumeChart({
  data,
}: {
  data: Array<{ month: string; sidesBW: number; sidesColor: number; sheets: number }>;
}) {
  if (!data || data.length === 0) {
    return <p className="text-xs text-slate-500 py-8 text-center">Belum ada volume fotokopi tercatat.</p>;
  }
  const maxSides = Math.max(10, ...data.map((d) => d.sidesBW + d.sidesColor));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-slate-700" />
          Hitam Putih (sisi)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-[#1755CE]" />
          Warna (sisi)
        </span>
      </div>

      <div className="space-y-3">
        {data.map((m) => {
          const bwPct = (m.sidesBW / maxSides) * 100;
          const clrPct = (m.sidesColor / maxSides) * 100;
          return (
            <div key={m.month} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono tabular-nums font-medium text-slate-700">{m.month}</span>
                <span className="font-mono tabular-nums text-slate-600">
                  {(m.sidesBW + m.sidesColor).toLocaleString('id-ID')} sisi ·{' '}
                  <strong className="text-slate-900">{m.sheets.toLocaleString('id-ID')} lembar</strong>
                </span>
              </div>
              <div className="h-3 w-full bg-slate-100 rounded overflow-hidden flex">
                <div
                  className="bg-slate-700 h-full"
                  style={{ width: `${bwPct}%` }}
                  title={`Hitam Putih: ${m.sidesBW} sisi`}
                />
                <div
                  className="bg-[#1755CE] h-full"
                  style={{ width: `${clrPct}%` }}
                  title={`Warna: ${m.sidesColor} sisi`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
