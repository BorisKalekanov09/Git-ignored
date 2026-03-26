import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas } from '@react-three/fiber/native';

type HeatPoint = { x: number; y: number; z: number; temp: number };
type Cell = { id: string; index_x: number; index_y: number; status: string };
type Hangar = { id: string; width: number; height: number };

const SCALE = 2; // world units per meter
const CELL_M = 0.2; // 20cm per cell in meters
const CELL_W = CELL_M * SCALE; // cell size in world units

/**
 * Renders a single flat cell tile on the top face of the box
 */
function CellTile({ cell, boxW, boxD, topY }: {
  cell: Cell;
  boxW: number;
  boxD: number;
  topY: number;
}) {
  const color =
    cell.status === 'completed' ? '#4CAF50' :
    cell.status === 'active'    ? '#00D5FF' : '#2A2A2A';

  const emissive =
    cell.status === 'completed' ? '#1a6e1a' :
    cell.status === 'active'    ? '#006688' : '#000000';

  // Center of this cell in world space, offset so whole grid is centered
  const cx = (cell.index_x + 0.5) * CELL_W - boxW / 2;
  const cz = (cell.index_y + 0.5) * CELL_W - boxD / 2;
  const GAP = 0.02; // small gap around each cell for grid lines

  return (
    <mesh
      position={[cx, topY + 0.005, cz]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[CELL_W - GAP, CELL_W - GAP]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.4} />
    </mesh>
  );
}

function SiloScene({
  data,
  cells,
  hangar,
}: {
  data: HeatPoint[];
  cells: Cell[];
  hangar: Hangar | null;
}) {
  const boxW = (hangar?.width  ?? 2) * SCALE;
  const boxD = (hangar?.height ?? 2) * SCALE;
  const boxH = 1.2;
  const topY = boxH; // top face Y position

  const latest = data[data.length - 1];

  return (
    <group>
      {/* ── Rectangular Parallelepiped Hull ── */}
      <mesh position={[0, boxH / 2, 0]}>
        <boxGeometry args={[boxW, boxH, boxD]} />
        <meshStandardMaterial color="#1a3a2a" transparent opacity={0.5} wireframe={false} />
      </mesh>

      {/* Wireframe outline */}
      <mesh position={[0, boxH / 2, 0]}>
        <boxGeometry args={[boxW, boxH, boxD]} />
        <meshStandardMaterial color="#5AFF8A" transparent opacity={0.2} wireframe />
      </mesh>

      {/* ── Cell grid on TOP face ── */}
      {cells.map(cell => (
        <CellTile
          key={cell.id}
          cell={cell}
          boxW={boxW}
          boxD={boxD}
          topY={topY}
        />
      ))}

      {/* Live Robot Marker on top */}
      {latest && (
        <mesh position={[latest.x, topY + 0.18, latest.z]}>
          <sphereGeometry args={[0.18]} />
          <meshStandardMaterial color="#00D5FF" emissive="#00D5FF" emissiveIntensity={1.5} />
        </mesh>
      )}
    </group>
  );
}

const SiloMap = ({
  points = [],
  cells = [],
  hangar = null,
}: {
  points: HeatPoint[];
  cells?: Cell[];
  hangar?: Hangar | null;
}) => {
  const boxW = (hangar?.width  ?? 2) * SCALE;
  const boxD = (hangar?.height ?? 2) * SCALE;
  // Camera sits above and to the side looking down at the top face
  const camX = boxW * 0.8;
  const camY = Math.max(boxW, boxD) * 1.4 + 3;
  const camZ = boxD * 0.8;

  return (
    <View style={styles.container}>
      <Canvas camera={{ position: [camX, camY, camZ], fov: 50 }}>
        <color attach="background" args={['#050A08']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 10, 5]} intensity={1.5} />
        <SiloScene data={points} cells={cells} hangar={hangar} />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 420,
    width: '100%',
    backgroundColor: '#050A08',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1A2A1A',
  },
});

export default SiloMap;