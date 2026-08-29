export function LinearProgress({ status, label, indeterminate, percent, className }) {
    const determinate = !indeterminate;
    const value = determinate ? (Number.isFinite(percent) ? percent : status === "running" ? 0 : 100) : undefined;
    return (
        <div
            className={["linear-progress", determinate ? "linear-progress-meter" : "", className].filter(Boolean).join(" ")}
            data-progress={status}
            data-determinate={determinate ? "true" : undefined}
            role="progressbar"
            aria-label={label}
            aria-busy={indeterminate ? "true" : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
            aria-valuetext={determinate ? `${value}%` : "in progress"}
        >
            <span className="linear-progress-bar" style={value == null ? undefined : { width: `${value}%` }} />
        </div>
    );
}
