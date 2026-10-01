import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { AgentState, type Simulation } from '../engine/simulation';
import { Cell } from '../engine/types';
import { agentRgb, paintCells, paintSmoke } from './paint';

const WALL_HEIGHT = 2.2;
const AGENT_HEIGHT = 1.6;

interface Props {
  sim: Simulation;
  heatmap: boolean;
  onCellClick: (gx: number, gy: number) => void;
}

/** 3D view: walls extruded from the grid, agents as instanced cylinders, fire columns and a smoke layer. */
export function View3D({ sim, heatmap, onCellClick }: Props) {
  const span = Math.max(sim.width, sim.height) * sim.cellSize;
  return (
    <Canvas className="view-canvas" camera={{ position: [0, span * 0.8, span * 0.75], fov: 45, near: 0.1, far: 1000 }}>
      <color attach="background" args={['#11151c']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[span * 0.3, span, span * 0.4]} intensity={1.6} />
      <FitCamera span={span} />
      <group key={sim.id}>
        <Floor sim={sim} heatmap={heatmap} onCellClick={onCellClick} />
        <Walls sim={sim} />
        <Exits sim={sim} />
        <Agents sim={sim} />
        <Fire sim={sim} />
        <SmokeLayer sim={sim} />
      </group>
      <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.47} />
    </Canvas>
  );
}

/** World position of grid point (gx, gy); the plan is centred on the origin, grid y runs along +z. */
function toWorld(sim: Simulation, gx: number, gy: number): [number, number] {
  return [(gx - sim.width / 2) * sim.cellSize, (gy - sim.height / 2) * sim.cellSize];
}

function cellsWhere(sim: Simulation, test: (type: number) => boolean): number[] {
  const out: number[] = [];
  sim.plan.cells.forEach((type, i) => {
    if (test(type)) out.push(i);
  });
  return out;
}

function useGridTexture(sim: Simulation, filter: THREE.MagnificationTextureFilter) {
  const texture = useMemo(() => {
    const data = new Uint8Array(sim.width * sim.height * 4);
    const tex = new THREE.DataTexture(data, sim.width, sim.height, THREE.RGBAFormat);
    tex.magFilter = filter;
    tex.minFilter = filter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return { tex, data };
  }, [sim, filter]);
  useEffect(() => () => texture.tex.dispose(), [texture]);
  return texture;
}

function FitCamera({ span }: { span: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(0, span * 0.8, span * 0.75);
    camera.lookAt(0, 0, 0);
  }, [camera, span]);
  return null;
}

function Floor({ sim, heatmap, onCellClick }: Props) {
  const { tex, data } = useGridTexture(sim, THREE.NearestFilter);
  useFrame(() => {
    paintCells(sim, data, { heatmap, smoke: false, flipY: true });
    tex.needsUpdate = true;
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // the pointer moved: it was a camera drag
    e.stopPropagation();
    const gx = Math.floor(e.point.x / sim.cellSize + sim.width / 2);
    const gy = Math.floor(e.point.z / sim.cellSize + sim.height / 2);
    if (gx >= 0 && gy >= 0 && gx < sim.width && gy < sim.height) onCellClick(gx, gy);
  };

  return (
    <mesh rotation-x={-Math.PI / 2} onClick={handleClick}>
      <planeGeometry args={[sim.width * sim.cellSize, sim.height * sim.cellSize]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

function Walls({ sim }: { sim: Simulation }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const cells = useMemo(() => cellsWhere(sim, (t) => t === Cell.Wall), [sim]);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    const m = new THREE.Matrix4();
    const cs = sim.cellSize;
    cells.forEach((i, k) => {
      const gx = i % sim.width;
      const [wx, wz] = toWorld(sim, gx + 0.5, (i - gx) / sim.width + 0.5);
      mesh.setMatrixAt(k, m.makeScale(cs, WALL_HEIGHT, cs).setPosition(wx, WALL_HEIGHT / 2, wz));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [sim, cells]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]} frustumCulled={false}>
      <boxGeometry />
      <meshStandardMaterial color="#c9ced8" />
    </instancedMesh>
  );
}

function Exits({ sim }: { sim: Simulation }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const cells = useMemo(() => cellsWhere(sim, (t) => t === Cell.Exit), [sim]);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    const m = new THREE.Matrix4();
    const cs = sim.cellSize;
    cells.forEach((i, k) => {
      const gx = i % sim.width;
      const [wx, wz] = toWorld(sim, gx + 0.5, (i - gx) / sim.width + 0.5);
      mesh.setMatrixAt(k, m.makeScale(cs, WALL_HEIGHT, cs).setPosition(wx, WALL_HEIGHT / 2, wz));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [sim, cells]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]} frustumCulled={false}>
      <boxGeometry />
      <meshBasicMaterial color="#3ddc84" transparent opacity={0.35} depthWrite={false} />
    </instancedMesh>
  );
}

function Agents({ sim }: { sim: Simulation }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      s: new THREE.Vector3(),
      c: new THREE.Color(),
    }),
    [],
  );

  const update = () => {
    const mesh = ref.current;
    if (!mesh) return;
    const { m, p, q, s, c } = tmp;
    for (let a = 0; a < sim.agentCount; a++) {
      const state = sim.state[a];
      const [wx, wz] = toWorld(sim, sim.x[a], sim.y[a]);
      if (state === AgentState.Evacuated) {
        p.set(wx, 0, wz);
        s.set(0, 0, 0);
      } else if (state === AgentState.Dead) {
        p.set(wx, 0.06, wz);
        s.set(1.2, 0.08, 1.2);
      } else {
        p.set(wx, AGENT_HEIGHT / 2, wz);
        s.set(1, 1, 1);
      }
      mesh.setMatrixAt(a, m.compose(p, q, s));
      const [r, g, b] = agentRgb(state, sim.health[a]);
      mesh.setColorAt(a, c.setRGB(r, g, b, THREE.SRGBColorSpace));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  // Populate instance colours before the first render so the shader is compiled with them.
  useLayoutEffect(update);
  useFrame(update);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, sim.agentCount]} frustumCulled={false}>
      <cylinderGeometry args={[0.2, 0.2, AGENT_HEIGHT, 10]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}

function Fire({ sim }: { sim: Simulation }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const capacity = useMemo(() => cellsWhere(sim, (t) => t !== Cell.Wall).length, [sim]);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame(({ clock }) => {
    const mesh = ref.current!;
    const cells = sim.fire.burningCells;
    const t = clock.elapsedTime;
    const cs = sim.cellSize;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const gx = i % sim.width;
      const [wx, wz] = toWorld(sim, gx + 0.5, (i - gx) / sim.width + 0.5);
      const height = 0.5 + 0.5 * (1 + Math.sin(t * 9 + i * 1.7));
      mesh.setMatrixAt(k, m.makeScale(cs * 0.9, height, cs * 0.9).setPosition(wx, height / 2, wz));
    }
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, capacity]} count={0} frustumCulled={false}>
      <boxGeometry />
      <meshBasicMaterial color="#ff6a14" transparent opacity={0.85} toneMapped={false} />
    </instancedMesh>
  );
}

function SmokeLayer({ sim }: { sim: Simulation }) {
  const { tex, data } = useGridTexture(sim, THREE.LinearFilter);
  useFrame(() => {
    paintSmoke(sim, data, true);
    tex.needsUpdate = true;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={WALL_HEIGHT * 0.9}>
      <planeGeometry args={[sim.width * sim.cellSize, sim.height * sim.cellSize]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
