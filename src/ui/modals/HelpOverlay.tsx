/** 操作説明(❓)。PC とタッチの両方をここに集約し、HUD 上の説明文は最小限にする。 */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="hud-help" onClick={onClose}>
      <div className="hud-help-panel" onClick={(e) => e.stopPropagation()}>
        <h2>操作説明</h2>
        <h3>マウス / キーボード</h3>
        <table>
          <tbody>
            <tr><td>左ドラッグ / ホイール</td><td>視点の回転 / 寄り引き</td></tr>
            <tr><td>青マーカーをクリック</td><td>移動(1歩=1ターン)。ホバーで同じ高さの範囲表示</td></tr>
            <tr><td>敵をクリック</td><td>武器リーチ内なら攻撃(ホバーで情報)</td></tr>
            <tr><td>バブルをクリック</td><td>ファストトラベル(敵に気づかれる・画面タップ・ESC で中断)</td></tr>
            <tr><td>TAB / Shift+TAB</td><td>敵・部屋へ視線やフォーカスを巡回 / 逆順</td></tr>
            <tr><td>M</td><td>マップモード切替(ドラッグ=回転 / Space+ドラッグ=移動)</td></tr>
            <tr><td>ESC</td><td>ファストトラベルの中断 / マップを閉じる</td></tr>
          </tbody>
        </table>
        <h3>タッチ(スマートフォン)</h3>
        <table>
          <tbody>
            <tr><td>1本指ドラッグ / ピンチ</td><td>視点の回転 / 寄り引き</td></tr>
            <tr><td>2本指ドラッグ</td><td>視点の移動(マップ中)</td></tr>
            <tr><td>マーカー・敵・バブル</td><td><b>1度目のタップ=選択</b>(情報表示)、<b>2度目=実行</b></td></tr>
            <tr><td>◀ ▶ ボタン</td><td>敵・部屋の巡回(TAB の代わり)</td></tr>
          </tbody>
        </table>
        <h3>しくみ</h3>
        <table>
          <tbody>
            <tr><td>🔥明かり</td><td>広げるほど視界と回復が増すが、敵に気づかれやすい</td></tr>
            <tr><td>盾</td><td>回避率+。両手武器(長槍・大鎚)とは併用不可</td></tr>
            <tr><td>合成</td><td>同じアイテム・同じ品質の2つ → 品質+1(1ターン)</td></tr>
            <tr><td>罠</td><td>足元か隣接セルに設置。敵が踏むと発動</td></tr>
            <tr>
              <td>スキル</td>
              <td>
                関門を越えるとスロットが増え、3択から1つ選ぶ。マスタリー(武技=武器討伐・盾=回避・甲殻=吸収・拳闘=素手討伐・隠密=不意打ち討伐・罠師=罠討伐・灯火=暗がりでの関門通過)を育てると候補が増える。死んでもマスタリーは残る
              </td>
            </tr>
            <tr><td>セーブ</td><td>毎ターン自動保存。死ぬと消える(再挑戦のみ)</td></tr>
            <tr><td>🏆 みんなの記録</td><td>タイトルの共有スコアボード。関門通過ごとに深度・討伐・構成を送信(名前は任意)</td></tr>
          </tbody>
        </table>
        <p className="hud-help-links">
          <a href={`${import.meta.env.BASE_URL}bgm.html`} target="_blank" rel="noreferrer">
            ♪ BGM 試聴室(深度・スタイル別に聴ける)
          </a>
        </p>
        <button className="primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
