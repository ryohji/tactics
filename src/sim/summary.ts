// バランスシミュレータ(rogue-19a)の集計。RunResult[] → 方策別の分布・整形テーブル。
// Three/React 非依存の純関数のみ。

import type { RunResult } from './runner';

export interface Summary {
  policy: string;
  runs: number;
  deathRate: number;
  avgTurns: number;
  depth: { min: number; p25: number; p50: number; p75: number; p90: number; max: number };
  /** 通過済みの層数(rogue-19b)の平均・最大。0 なら誰も崩落を踏んでいない。 */
  stratum: { avg: number; max: number };
  /** 死因(とどめを刺した敵の名前)の出現回数。多い順。 */
  deathCauses: { cause: string; count: number }[];
}

/** 昇順ソート済み配列の p パーセンタイル(最近傍法。空なら0)。 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1)));
  return sorted[idx];
}

/** RunResult[] を policy ごとにまとめ、到達深度の分布・死亡率・死因を集計する。 */
export function summarize(results: readonly RunResult[]): Summary[] {
  const byPolicy = new Map<string, RunResult[]>();
  for (const r of results) {
    const list = byPolicy.get(r.policy) ?? [];
    list.push(r);
    byPolicy.set(r.policy, list);
  }
  return [...byPolicy.entries()]
    .map(([policy, rs]) => {
      const depths = rs.map((r) => r.maxDepth).sort((a, b) => a - b);
      const deaths = rs.filter((r) => r.phase === 'dead');
      const causeCount = new Map<string, number>();
      for (const d of deaths) {
        const cause = d.deathCause ?? '不明';
        causeCount.set(cause, (causeCount.get(cause) ?? 0) + 1);
      }
      const deathCauses = [...causeCount.entries()]
        .map(([cause, count]) => ({ cause, count }))
        .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));
      return {
        policy,
        runs: rs.length,
        deathRate: deaths.length / rs.length,
        avgTurns: rs.reduce((sum, r) => sum + r.turns, 0) / rs.length,
        depth: {
          min: depths[0] ?? 0,
          p25: percentile(depths, 25),
          p50: percentile(depths, 50),
          p75: percentile(depths, 75),
          p90: percentile(depths, 90),
          max: depths[depths.length - 1] ?? 0,
        },
        stratum: {
          avg: rs.reduce((sum, r) => sum + r.stratum, 0) / rs.length,
          max: Math.max(...rs.map((r) => r.stratum)),
        },
        deathCauses,
      };
    })
    .sort((a, b) => a.policy.localeCompare(b.policy));
}

/** 方策別の要約テーブルを Markdown 見出し付きで整形する(標準出力・レポート両用)。 */
export function formatSummary(summaries: readonly Summary[]): string {
  const lines: string[] = [];
  for (const s of summaries) {
    lines.push(`## ${s.policy} (n=${s.runs})`);
    lines.push('');
    lines.push(
      `- 到達深度: min=${s.depth.min} p25=${s.depth.p25} p50=${s.depth.p50} p75=${s.depth.p75} p90=${s.depth.p90} max=${s.depth.max}`,
    );
    lines.push(`- 平均ターン: ${s.avgTurns.toFixed(1)}`);
    lines.push(`- 死亡率: ${(s.deathRate * 100).toFixed(1)}%`);
    lines.push(`- 通過層数(崩落): avg=${s.stratum.avg.toFixed(2)} max=${s.stratum.max}`);
    if (s.deathCauses.length > 0) {
      lines.push(`- 死因: ${s.deathCauses.map((c) => `${c.cause}×${c.count}`).join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
