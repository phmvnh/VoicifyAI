export function LevelMeter({ value = 0, label }: { value?: number; label: string }) {
  return (
    <div className="level-meter" aria-label={`${label}: ${Math.round(value * 100)}%`}>
      {Array.from({ length: 9 }, (_, index) => (
        <i key={index} className={index / 9 < value ? "active" : ""} />
      ))}
    </div>
  );
}

