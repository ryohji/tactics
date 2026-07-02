import { Canvas } from "@react-three/fiber";
import { Scene } from "./render/Scene";
import { Controls } from "./ui/Controls";

// it-1 合成点（W5 統合担当）。
// Canvas 内は <Scene/> に集約（ライト・地形・マーカー・TPカメラ）。
// Canvas 外に <Controls/>（leva パネルを登録。DOM は leva がグローバルに描く）。
// クリック移動は Markers の InstancedMesh onClick → pick → store.setActive で駆動する。
export function App() {
  return (
    <>
      <Canvas camera={{ position: [8, 8, 8], fov: 42 }}>
        <Scene />
      </Canvas>
      <Controls />
    </>
  );
}
