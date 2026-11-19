import {
  attendanceCategories,
  type AttendanceCategory,
} from "../lib/daily-attendance-summary";

const chartStyle: Record<AttendanceCategory, { label: string; color: string }> =
  {
    present: { label: "उपस्थित / Present", color: "#168465" },
    on_duty: { label: "ड्यूटी पर / On Duty", color: "#3772c3" },
    deputation: { label: "प्रतिनियुक्ति / Deputation", color: "#8353ba" },
    leave: { label: "अवकाश / On leave", color: "#e5a12e" },
    absent: { label: "अनुपस्थित / Absent", color: "#d76158" },
    not_marked: { label: "दर्ज नहीं / Not marked", color: "#8290a3" },
    other: { label: "अन्य / Other", color: "#526475" },
  };

function point(degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: 120 + 104 * Math.cos(radians),
    y: 120 + 104 * Math.sin(radians),
  };
}

function wedge(start: number, end: number) {
  const from = point(start);
  const to = point(end);
  return `M 120 120 L ${from.x} ${from.y} A 104 104 0 ${end - start > 180 ? 1 : 0} 1 ${to.x} ${to.y} Z`;
}

export default function AttendancePieChart({
  counts,
}: {
  counts: Record<AttendanceCategory, number>;
}) {
  const total = attendanceCategories.reduce(
    (sum, category) => sum + counts[category],
    0,
  );
  let start = 0;
  const slices = attendanceCategories.flatMap((category) => {
    const count = counts[category];
    if (!count || !total) return [];
    const end = start + (count / total) * 360;
    const slice = { category, start, end, count };
    start = end;
    return [slice];
  });

  return (
    <div className="sp-attendance-chart">
      <div className="sp-attendance-chart-figure">
        <svg
          viewBox="0 0 240 240"
          role="img"
          aria-label={`Attendance distribution for ${total} staff`}
        >
          <title>Attendance distribution</title>
          {total === 0 ? (
            <circle cx="120" cy="120" r="104" fill="#dce4ed" />
          ) : (
            slices.map(({ category, start, end, count }) =>
              count === total ? (
                <circle
                  key={category}
                  cx="120"
                  cy="120"
                  r="104"
                  fill={chartStyle[category].color}
                />
              ) : (
                <path
                  key={category}
                  d={wedge(start, end)}
                  fill={chartStyle[category].color}
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              ),
            )
          )}
        </svg>
        <p>{total} कर्मी / staff</p>
      </div>
      <ul
        className="sp-attendance-chart-legend"
        aria-label="Attendance categories"
      >
        {attendanceCategories
          .filter((category) => category !== "other" || counts.other > 0)
          .map((category) => (
            <li key={category}>
              <span
                className="sp-attendance-chart-swatch"
                style={{ backgroundColor: chartStyle[category].color }}
                aria-hidden="true"
              />
              <span className="sp-attendance-chart-label">
                {chartStyle[category].label}
              </span>
              <strong>{counts[category]}</strong>
              <small>
                {total ? Math.round((counts[category] / total) * 100) : 0}%
              </small>
            </li>
          ))}
      </ul>
    </div>
  );
}
