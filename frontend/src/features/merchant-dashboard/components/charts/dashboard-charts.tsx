import type { TrendPoint } from "../../providers/merchant-analytics";

export function LiveLineChart({
  ariaLabel,
  data,
  height = 250,
  formatValue
}: {
  ariaLabel: string;
  data: TrendPoint[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const width = 900;
  const padTop = 24;
  const padBottom = 40;
  const padLeft = 60;
  const padRight = 20;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);

  const points = data.map((d, i) => ({
    x: padLeft + (i / Math.max(data.length - 1, 1)) * chartW,
    y: padTop + chartH - ((d.value - min) / range) * chartH,
    label: d.label,
    value: d.value
  }));

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area = `${path} L ${points[points.length - 1]?.x ?? padLeft + chartW} ${padTop + chartH} L ${padLeft} ${padTop + chartH} Z`;

  const gridLines = 4;
  const fmt = formatValue ?? ((v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-[#fafafa]">
      <svg className="h-auto w-full" role="img" viewBox={`0 0 ${width} ${height}`} aria-label={ariaLabel}>
        <defs>
          <linearGradient id="live-revenue-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#09090b" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#09090b" stopOpacity="0.00" />
          </linearGradient>
        </defs>

        {/* y-axis grid lines + labels */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const y = padTop + (chartH / gridLines) * i;
          const val = max - (range / gridLines) * i;
          return (
            <g key={i}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#e4e4e7" strokeDasharray="4 4" strokeWidth="1" />
              <text x={padLeft - 10} y={y + 4} textAnchor="end" fill="#a1a1aa" fontSize="11" fontFamily="var(--font-app-sans), system-ui, sans-serif" fontWeight="600">
                {fmt(val)}
              </text>
            </g>
          );
        })}

        {/* area fill */}
        {points.length > 1 && <path d={area} fill="url(#live-revenue-gradient)" />}

        {/* line */}
        {points.length > 1 && (
          <path d={path} fill="none" stroke="#09090b" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
        )}

        {/* dots */}
        {points.map((p, i) => (
          <circle cx={p.x} cy={p.y} fill="#ffffff" key={i} r="4" stroke="#09090b" strokeWidth="2" />
        ))}

        {/* x-axis labels */}
        {points.map((p, i) => {
          // show every other label to avoid clutter
          if (data.length > 8 && i % 2 !== 0 && i !== data.length - 1) {
            return null;
          }
          return (
            <text
              key={`xl-${i}`}
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              fill="#a1a1aa"
              fontSize="10"
              fontFamily="var(--font-app-sans), system-ui, sans-serif"
              fontWeight="500"
            >
              {p.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

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

export function LiveBarChart({ data, height = 280 }: { data: TrendPoint[]; height?: number }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-[#fafafa] p-4" style={{ height: `${height}px` }}>
      {data.map((point, index) => {
        // Only show every other label if there are too many data points
        const showLabel = data.length <= 8 || (index % 2 === 0 || index === data.length - 1);
        return (
          <div className="group relative flex min-w-0 flex-1 flex-col items-center gap-2" key={index}>
            <div
              className="w-full rounded-t-[4px] bg-zinc-900 transition-all duration-300 hover:bg-zinc-700"
              style={{ height: `${Math.max(16, (point.value / max) * (height - 48))}px` }}
            />
            {showLabel ? (
              <span className="text-[10px] font-medium text-zinc-400 font-sans truncate w-full text-center">{point.label}</span>
            ) : (
              <span className="text-[10px] text-transparent h-[15px] block">&nbsp;</span>
            )}
            {/* Tooltip */}
            <div className="absolute -top-10 hidden whitespace-nowrap rounded-lg bg-zinc-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg group-hover:block z-10 animate-fade-in pointer-events-none">
              {point.label}: {point.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LiveMiniBars({ data }: { data: TrendPoint[] }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex h-28 items-end gap-1 rounded-xl border border-zinc-200 bg-[#fafafa] p-3">
      {data.map((point, index) => (
        <div
          className="group relative min-w-0 flex-1 rounded-t-[2px] bg-zinc-900 transition-colors hover:bg-zinc-700"
          key={index}
          style={{ height: `${Math.max(8, (point.value / max) * 96)}px` }}
        >
          {/* Tooltip */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 hidden whitespace-nowrap rounded-lg bg-zinc-950 px-2 py-1 text-[10px] font-semibold text-white shadow-lg group-hover:block z-10 pointer-events-none">
            {point.value}
          </div>
        </div>
      ))}
    </div>
  );
}
