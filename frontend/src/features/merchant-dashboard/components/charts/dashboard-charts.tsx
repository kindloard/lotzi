export function LineChart({ ariaLabel, data, height }: { ariaLabel: string; data: number[]; height: number }) {
  const width = 900;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / Math.max(1, max - min)) * (height - 36) - 18;
    return { x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = `${path} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-[#f9f9fb]">
      <svg className="h-auto w-full" role="img" viewBox={`0 0 ${width} ${height}`} aria-label={ariaLabel}>
        <defs>
          <linearGradient id="merchant-revenue-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#09090b" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#09090b" stopOpacity="0.00" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => (
          <line key={line} x1="0" x2={width} y1={(height / 4) * line} y2={(height / 4) * line} stroke="#ededf0" strokeDasharray="6 6" strokeWidth="1" />
        ))}
        <path d={area} fill="url(#merchant-revenue-fill)" />
        <path d={path} fill="none" stroke="#09090b" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
        {points.map((point, index) => (
          <circle cx={point.x} cy={point.y} fill="#ffffff" key={index} r="4.5" stroke="#09090b" strokeWidth="2" />
        ))}
      </svg>
    </div>
  );
}

export function BarChart({ data, height }: { data: number[]; height: number }) {
  const max = Math.max(...data);
  return (
    <div className="flex h-[280px] items-end gap-2 rounded-2xl border border-zinc-200 bg-[#f9f9fb] p-4">
      {data.map((value, index) => (
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2" key={index}>
          <div
            className="w-full rounded-t-[4px] bg-zinc-900 hover:bg-zinc-950 transition-colors"
            style={{ height: `${Math.max(16, (value / max) * (height - 48))}px` }}
          />
          <span className="text-[10px] font-medium text-zinc-400 font-mono">{index + 1}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniBars({ data }: { data: number[] }) {
  const max = Math.max(...data);
  return (
    <div className="flex h-28 items-end gap-1 rounded-xl border border-zinc-200 bg-[#f9f9fb] p-3">
      {data.map((value, index) => (
        <div
          className="min-w-0 flex-1 rounded-t-[2px] bg-zinc-900"
          key={index}
          style={{ height: `${Math.max(8, (value / max) * 96)}px` }}
        />
      ))}
    </div>
  );
}

