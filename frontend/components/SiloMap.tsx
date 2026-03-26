import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import * as THREE from 'three';

type HeatPoint = { x: number; y: number; z: number; temp: number };
type Cell = { id: string; index_x: number; index_y: number; status: string };
type Hangar = { id: string; width: number; height: number };

const SCALE = 2;
const CELL_M = 0.2;
const CELL_W = CELL_M * SCALE;

/**
 * A single coloured tile on the top face.
 * `swapped` = true when we've rotated so index_y → X (long side), index_x → Z (short side).
 */
function CellTile({
  cell, longSide, shortSide, swapped,
}: {
  cell: Cell; longSide: number; shortSide: number; swapped: boolean;
}) {
  const color =
    cell.status === 'completed' ? '#4CAF50' :
    cell.status === 'active'    ? '#00D5FF' : '#0B140B'; // Very dark to let grid lines pop

  const emissive =
    cell.status === 'completed' ? '#2a7a2a' :
    cell.status === 'active'    ? '#006688' : '#000000';

  // X axis = longSide (left-right), Z axis = shortSide (toward camera)
  const cx = swapped
    ? (cell.index_y + 0.5) * CELL_W - longSide / 2
    : (cell.index_x + 0.5) * CELL_W - longSide / 2;
  const cz = swapped
    ? (cell.index_x + 0.5) * CELL_W - shortSide / 2
    : (cell.index_y + 0.5) * CELL_W - shortSide / 2;

  // Make gap big enough to show crisp grid lines
  const GAP = 0.035;

  return (
    <mesh position={[cx, 0.006, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[CELL_W - GAP, CELL_W - GAP]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.6} />
    </mesh>
  );
}

function BarnScene({
  data, cells, longSide, shortSide, boxH, swapped,
}: {
  data: HeatPoint[];
  cells: Cell[];
  longSide: number;
  shortSide: number;
  boxH: number;
  swapped: boolean;
}) {
  const latest = data[data.length - 1];

  // Creates just the border edges (no diagonal triangles)
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(longSide, boxH, shortSide)),
    [longSide, shortSide, boxH]
  );

  // Shift group DOWN so the top face sits at y = 0
  return (
    <group position={[0, -boxH, 0]}>
      {/* Solid barn body */}
      <mesh position={[0, boxH / 2, 0]}>
        {/* X = long (left-right), Y = height, Z = short (towards camera) */}
        <boxGeometry args={[longSide, boxH, shortSide]} />
        <meshStandardMaterial color="#101F10" />
      </mesh>

      {/* Crisp Outline along the 12 box edges */}
      <lineSegments geometry={edges} position={[0, boxH / 2, 0]}>
        <lineBasicMaterial color="#3DFF80" linewidth={2} transparent opacity={0.6} />
      </lineSegments>



      {/* Cell grid on the top face */}
      <group position={[0, boxH, 0]}>
        
        {/* ── Grid Outline Layer (Grout) ── */}
        {/* Sits just beneath the cells. The gaps between cells reveal this colour, creating a sharp grid outline. */}
        <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[longSide, shortSide]} />
          <meshBasicMaterial color="#3DFF80" transparent opacity={0.35} />
        </mesh>

        {cells.map(cell => (
          <CellTile
            key={cell.id}
            cell={cell}
            longSide={longSide}
            shortSide={shortSide}
            swapped={swapped}
          />
        ))}

        {latest && (
          <mesh position={[
            swapped ? latest.z : latest.x,
            0.25,
            swapped ? latest.x : latest.z
          ]}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshStandardMaterial
              color="#00D5FF"
              emissive="#00D5FF"
              emissiveIntensity={1.8}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}

const SiloMap = ({
  points = [],
  cells  = [],
  hangar = null,
}: {
  points:  HeatPoint[];
  cells?:  Cell[];
  hangar?: Hangar | null;
}) => {
  const dimX = (hangar?.width  ?? 2) * SCALE; // maps to index_x
  const dimZ = (hangar?.height ?? 2) * SCALE; // maps to index_y
  const boxH = 1.4;

  // Always put the LONG dimension left-right (X axis) to face the user
  const swapped   = dimZ > dimX;
  const longSide  = swapped ? dimZ : dimX;   // X axis (horizontal)
  const shortSide = swapped ? dimX : dimZ;   // Z axis (depth)

  // ── Camera: properly centered, long face facing the user ──
  // Pushed the camera further back (increased multipliers) so it fits with padding
  const dist = longSide * 1.3 + 3.5;
  const camX = 0; // centered horizontally
  const camY = dist * 0.8; // looking down from higher up
  const camZ = shortSide * 0.6 + dist * 0.8; // backed out further
  const fov  = 55; // fixed balanced FOV

  return (
    <View style={styles.container}>
      <Canvas
        camera={{ position: [camX, camY, camZ], fov, near: 0.1, far: 300 }}
      >
        <color attach="background" args={['#040C06']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 10, 6]}  intensity={1.8} />
        <directionalLight position={[-3, 5, -4]} intensity={0.4} />
        <BarnScene
          data={points}
          cells={cells}
          longSide={longSide}
          shortSide={shortSide}
          boxH={boxH}
          swapped={swapped}
        />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 440,
    width: '100%',
    backgroundColor: '#040C06',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1A3020',
  },
});

export default SiloMap;