// バランスシミュレータ(rogue-19a)の CLI エントリ。vite-node で実行する。
//   npm run balance -- --seeds 200 --policy all --out docs/balance/xxx.jsonl
//
// シードは 1..seeds を両方策(または指定方策)で1回ずつ回し、標準出力に
// 方策別の要約テーブルを出す。--out を渡すと RunResult を JSON Lines で書き出す。

import { appendFileSync, writeFileSync } from 'node:fs';
import { setTimeScaleForTest } from '../src/state/rogue';
import { greedy, cautious, type Policy } from '../src/sim/policies';
import { runOne, type RunResult } from '../src/sim/runner';
import { summarize, formatSummary } from '../src/sim/summary';

interface Args {
  seeds: number;
  policy: 'greedy' | 'cautious' | 'all';
  out?: string;
}

function parseArgs(argv: string[]): Args {
  let seeds = 200;
  let policy: Args['policy'] = 'all';
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seeds') seeds = Number(argv[++i]);
    else if (a === '--policy') policy = argv[++i] as Args['policy'];
    else if (a === '--out') out = argv[++i];
  }
  return { seeds, policy, out };
}

async function main(): Promise<void> {
  const { seeds, policy, out } = parseArgs(process.argv.slice(2));
  setTimeScaleForTest(0); // 演出待ちを飛ばしてヘッドレス高速実行

  const policies: [string, Policy][] =
    policy === 'all' ? [['greedy', greedy], ['cautious', cautious]] : [[policy, policy === 'greedy' ? greedy : cautious]];

  if (out) writeFileSync(out, ''); // 既存ファイルを空にしてから追記していく

  const results: RunResult[] = [];
  const t0 = Date.now();
  for (const [name, p] of policies) {
    for (let seed = 1; seed <= seeds; seed++) {
      const r = await runOne(seed, name, p);
      results.push(r);
      if (out) appendFileSync(out, JSON.stringify(r) + '\n');
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(formatSummary(summarize(results)));
  console.log(`(${results.length} runs / ${elapsed}s)`);
}

main();
