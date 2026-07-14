import { useRogue } from '../../state/rogue';

export function LogPanel() {
  const log = useRogue((s) => s.log);
  return (
    <div className="hud-log">
      {log.slice(-5).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
